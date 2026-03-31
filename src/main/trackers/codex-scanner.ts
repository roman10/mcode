/**
 * Scanner for Codex CLI JSONL transcript files.
 *
 * Discovers session transcripts in ~/.codex/sessions/ and parses them for
 * per-API-call token usage and human input data. Uses the same watermark
 * table as other scanners.
 *
 * Like Gemini (full-file reads with watermark), but uses INSERT OR IGNORE
 * because per-API-call entries are immutable once written.
 */

import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getDb } from '../db';
import { logger } from '../logger';
import { parseCodexTranscript } from './codex-transcript-parser';
import { localDateStr } from './date-utils';
import type { InputTracker } from './input-tracker';

function resolveCodexSessionsDir(): string {
  const codexHome = process.env['MCODE_CODEX_HOME'] ?? join(homedir(), '.codex');
  return join(codexHome, 'sessions');
}

export class CodexScanner {
  /**
   * Scan all Codex transcript directories for session JSONL files.
   * Returns total number of new token_usage entries inserted.
   */
  async scanAll(inputTracker: InputTracker): Promise<number> {
    const sessionsDir = resolveCodexSessionsDir();
    let yearDirs: string[];
    try {
      yearDirs = await readdir(sessionsDir);
    } catch {
      return 0; // ~/.codex/sessions/ doesn't exist
    }

    let totalNew = 0;

    // Walk year/month/day directory structure
    for (const year of yearDirs) {
      const yearPath = join(sessionsDir, year);
      let monthDirs: string[];
      try {
        monthDirs = await readdir(yearPath);
      } catch {
        continue;
      }

      for (const month of monthDirs) {
        const monthPath = join(yearPath, month);
        let dayDirs: string[];
        try {
          dayDirs = await readdir(monthPath);
        } catch {
          continue;
        }

        for (const day of dayDirs) {
          const dayPath = join(monthPath, day);
          let files: string[];
          try {
            files = await readdir(dayPath);
          } catch {
            continue;
          }

          for (const file of files) {
            if (!file.startsWith('rollout-') || !file.endsWith('.jsonl')) continue;
            try {
              const count = await this.scanFile(join(dayPath, file), inputTracker);
              totalNew += count;
            } catch {
              // Skip individual file errors
            }
          }
        }
      }
    }

    if (totalNew > 0) {
      logger.info('codex-scanner', `Scan complete, ${totalNew} new entries`);
    }

    return totalNew;
  }

  /**
   * Scan a single Codex transcript JSONL file.
   * Returns number of new token_usage entries inserted.
   */
  async scanFile(filePath: string, inputTracker: InputTracker): Promise<number> {
    const db = getDb();

    // Get current file size
    let fileSize: number;
    try {
      const s = await stat(filePath);
      fileSize = s.size;
    } catch {
      return 0;
    }

    // Check watermark — skip if file hasn't changed
    const tracked = db
      .prepare('SELECT last_scanned_offset FROM tracked_jsonl_files WHERE file_path = ?')
      .get(filePath) as { last_scanned_offset: number } | undefined;

    const lastOffset = tracked?.last_scanned_offset ?? 0;
    if (fileSize <= lastOffset) return 0;

    // Read full file (need to track model state across turns)
    const content = await readFile(filePath, 'utf-8');

    // Parse transcript
    const { sessionId, projectDir, tokenEntries, humanEntries } = parseCodexTranscript(content);
    if (!sessionId || !projectDir) return 0;

    // Insert token entries. INSERT OR IGNORE because per-API-call entries are
    // immutable — re-scanning the same file just skips existing entries.
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO token_usage
        (message_id, agent_session_id, project_dir, model,
         input_tokens, output_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
         cache_read_tokens, is_fast_mode, message_timestamp, date, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'codex')
    `);

    let newCount = 0;
    const insertAll = db.transaction(() => {
      for (const entry of tokenEntries) {
        const date = localDateStr(new Date(entry.timestamp));
        const result = insertStmt.run(
          entry.messageId,
          sessionId,
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
    });
    insertAll();

    // Insert human input entries
    inputTracker.insertBatch(humanEntries, sessionId, projectDir, 'codex');

    // Update watermark
    this.updateWatermark(filePath, fileSize, sessionId, projectDir);

    return newCount;
  }

  private updateWatermark(
    filePath: string,
    fileSize: number,
    sessionId: string,
    projectDir: string,
  ): void {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO tracked_jsonl_files (file_path, agent_session_id, project_dir, last_scanned_offset, file_size, last_scanned_at, provider)
      VALUES (?, ?, ?, ?, ?, ?, 'codex')
      ON CONFLICT(file_path) DO UPDATE SET
        last_scanned_offset = excluded.last_scanned_offset,
        file_size = excluded.file_size,
        last_scanned_at = excluded.last_scanned_at
    `).run(filePath, sessionId, projectDir, fileSize, fileSize, now);
  }
}
