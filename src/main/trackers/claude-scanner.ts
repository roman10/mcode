/**
 * Scanner for Claude Code JSONL transcript files.
 *
 * Discovers session files in ~/.claude/projects/ and incrementally parses
 * them for token usage and human input data using byte-offset watermarks.
 */

import { readdir, stat, open as fsOpen } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getDb } from '../db';
import {
  parseUsageFromChunk,
  parseHumanMessagesFromChunk,
  parseLatestCompactMarker,
} from './jsonl-usage-parser';
import type { InputTracker } from './input-tracker';
import { localDateStr } from './date-utils';

const SCAN_BATCH_SIZE = 20;

interface TrackedFileRecord {
  file_path: string;
  agent_session_id: string;
  project_dir: string;
  last_scanned_offset: number;
  file_size: number;
}

export class ClaudeScanner {
  /**
   * Scan all ~/.claude/projects/ directories for JSONL files.
   * Returns total number of new token_usage entries inserted.
   */
  async scanAll(inputTracker: InputTracker): Promise<number> {
    const projectsDir = join(homedir(), '.claude', 'projects');
    let projectDirs: string[];
    try {
      projectDirs = await readdir(projectsDir);
    } catch {
      return 0; // ~/.claude/projects/ doesn't exist
    }

    const allFiles: string[] = [];
    for (const proj of projectDirs) {
      const projPath = join(projectsDir, proj);
      try {
        const entries = await readdir(projPath, { recursive: true });
        for (const entry of entries) {
          if (typeof entry === 'string' && entry.endsWith('.jsonl')) {
            allFiles.push(join(projPath, entry));
          }
        }
      } catch {
        // Skip unreadable directories
      }
    }

    let totalNew = 0;
    for (let i = 0; i < allFiles.length; i += SCAN_BATCH_SIZE) {
      const batch = allFiles.slice(i, i + SCAN_BATCH_SIZE);
      for (const filePath of batch) {
        try {
          const count = await this.scanFile(filePath, inputTracker);
          totalNew += count;
        } catch {
          // Skip individual file errors
        }
      }
      // Yield event loop between batches
      if (i + SCAN_BATCH_SIZE < allFiles.length) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    return totalNew;
  }

  /**
   * Scan a single JSONL file incrementally using byte-offset watermarks.
   * Returns count of new entries inserted.
   */
  async scanFile(filePath: string, inputTracker: InputTracker): Promise<number> {
    const db = getDb();

    // Get current file size
    let fileSize: number;
    try {
      const s = await stat(filePath);
      fileSize = s.size;
    } catch {
      return 0; // File doesn't exist or can't be read
    }

    // Check watermark
    const tracked = db
      .prepare('SELECT * FROM tracked_jsonl_files WHERE file_path = ?')
      .get(filePath) as TrackedFileRecord | undefined;

    const lastOffset = tracked?.last_scanned_offset ?? 0;
    if (fileSize <= lastOffset) return 0; // No new data

    // Read new bytes
    const fh = await fsOpen(filePath, 'r');
    try {
      const bytesToRead = fileSize - lastOffset;
      const buf = Buffer.alloc(bytesToRead);
      await fh.read(buf, 0, bytesToRead, lastOffset);
      const chunk = buf.toString('utf-8');

      const isPartial = lastOffset > 0;
      const entries = parseUsageFromChunk(chunk, isPartial);
      const humanEntries = parseHumanMessagesFromChunk(chunk, isPartial);
      const compactMarkerTs = parseLatestCompactMarker(chunk, isPartial);

      if (entries.length === 0 && humanEntries.length === 0 && !compactMarkerTs) {
        // Update watermark even if no entries (file grew but no usage data)
        this.updateWatermark(filePath, fileSize);
        return 0;
      }

      // Derive session ID and project dir from file path
      const projectsDir = join(homedir(), '.claude', 'projects');
      const { sessionId: fileName, projectDir } = extractSessionMetadata(filePath, projectsDir);

      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO token_usage
          (message_id, agent_session_id, project_dir, model,
           input_tokens, output_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
           cache_read_tokens, is_fast_mode, message_timestamp, date, provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'claude')
      `);
      // `last_compact_at` bump is in the same transaction as token inserts
      // so a partial failure can't stamp the marker without the matching
      // rows. Guard `<` keeps it idempotent across re-scans.
      const updateCompactStmt = db.prepare(`
        UPDATE sessions
           SET last_compact_at = ?
         WHERE claude_session_id = ?
           AND (last_compact_at IS NULL OR last_compact_at < ?)
      `);

      let newCount = 0;
      const insertAll = db.transaction(() => {
        for (const entry of entries) {
          const date = localDateStr(new Date(entry.timestamp));
          const result = insertStmt.run(
            entry.messageId,
            fileName,
            projectDir,
            entry.model,
            entry.inputTokens,
            entry.outputTokens,
            entry.cacheWrite5mTokens,
            entry.cacheWrite1hTokens,
            entry.cacheReadTokens,
            entry.isFastMode ? 1 : 0,
            entry.timestamp,
            date,
          );
          if (result.changes > 0) newCount++;
        }
        if (compactMarkerTs) {
          updateCompactStmt.run(compactMarkerTs, fileName, compactMarkerTs);
        }
      });
      insertAll();

      // Insert human input entries via InputTracker
      inputTracker.insertBatch(humanEntries, fileName, projectDir);

      this.updateWatermark(filePath, fileSize, fileName, projectDir);

      return newCount;
    } finally {
      await fh.close();
    }
  }

  private updateWatermark(
    filePath: string,
    fileSize: number,
    agentSessionId?: string,
    projectDir?: string,
  ): void {
    const db = getDb();
    let sessionId = agentSessionId;
    let projDir = projectDir;
    if (!sessionId || !projDir) {
      const projectsDir = join(homedir(), '.claude', 'projects');
      const meta = extractSessionMetadata(filePath, projectsDir);
      sessionId ??= meta.sessionId;
      projDir ??= meta.projectDir;
    }
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO tracked_jsonl_files (file_path, agent_session_id, project_dir, last_scanned_offset, file_size, last_scanned_at, provider)
      VALUES (?, ?, ?, ?, ?, ?, 'claude')
      ON CONFLICT(file_path) DO UPDATE SET
        last_scanned_offset = excluded.last_scanned_offset,
        file_size = excluded.file_size,
        last_scanned_at = excluded.last_scanned_at
    `).run(filePath, sessionId, projDir, fileSize, fileSize, now);
  }
}

/**
 * Extract sessionId and projectDir from any JSONL file path under the projects directory.
 * Works for both top-level session files and nested subagent files:
 *   Main:     <projectsDir>/<projectDir>/<sessionId>.jsonl
 *   Subagent: <projectsDir>/<projectDir>/<sessionId>/subagents/<agentId>.jsonl
 */
export function extractSessionMetadata(
  filePath: string,
  projectsDir: string,
): { sessionId: string; projectDir: string } {
  const relative = filePath.slice(projectsDir.length + 1); // strip projectsDir + separator
  const segments = relative.split('/');
  const projectDir = segments[0];
  const raw = segments[1];
  const sessionId = raw.endsWith('.jsonl') ? raw.slice(0, -6) : raw;
  return { sessionId, projectDir };
}
