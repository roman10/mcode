/**
 * Scanner for Copilot CLI events.jsonl files.
 *
 * Discovers session directories in ~/.copilot/session-state/ and incrementally
 * parses events.jsonl files for token usage and human input data.
 *
 * Uses the same watermark pattern as the Claude scanner (tracked_jsonl_files table).
 */

import { existsSync } from 'node:fs';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from '../db';
import { logger } from '../logger';
import { parseCopilotShutdownTokens, parseCopilotHumanMessages } from './copilot-events-parser';
import { resolveCopilotStateDir } from '../session/copilot-session-store';
import { localDateStr } from './date-utils';
import type { InputTracker } from './input-tracker';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CopilotScanner {
  /**
   * Scan all Copilot session directories for events.jsonl files.
   * Returns total number of new token_usage entries inserted.
   */
  async scanAll(inputTracker: InputTracker): Promise<number> {
    const stateDir = resolveCopilotStateDir();
    if (!stateDir) return 0;

    let dirs: string[];
    try {
      dirs = await readdir(stateDir);
    } catch {
      return 0;
    }

    let totalNew = 0;
    for (const dirname of dirs) {
      if (!UUID_RE.test(dirname)) continue;

      const eventsPath = join(stateDir, dirname, 'events.jsonl');
      if (!existsSync(eventsPath)) continue;

      try {
        const count = await this.scanFile(eventsPath, dirname, inputTracker);
        totalNew += count;
      } catch {
        // Skip individual file errors
      }
    }

    if (totalNew > 0) {
      logger.info('copilot-scanner', `Scan complete, ${totalNew} new entries`);
    }

    return totalNew;
  }

  /**
   * Scan a single Copilot events.jsonl file.
   * Returns number of new token_usage entries inserted.
   */
  async scanFile(
    filePath: string,
    sessionId: string,
    inputTracker: InputTracker,
  ): Promise<number> {
    const db = getDb();

    // Get current file size
    let fileSize: number;
    try {
      const s = await stat(filePath);
      fileSize = s.size;
    } catch {
      return 0;
    }

    // Check watermark
    const tracked = db
      .prepare('SELECT last_scanned_offset FROM tracked_jsonl_files WHERE file_path = ?')
      .get(filePath) as { last_scanned_offset: number } | undefined;

    const lastOffset = tracked?.last_scanned_offset ?? 0;
    if (fileSize <= lastOffset) return 0;

    // For Copilot, we always read the full file because shutdown events
    // contain aggregate data that replaces previous partial data.
    // The watermark still prevents re-processing unchanged files.
    const content = await readFile(filePath, 'utf-8');

    // Extract cwd from the session.start event (first line)
    const projectDir = extractCwdFromContent(content);

    // Parse token usage from shutdown events
    const tokenEntries = parseCopilotShutdownTokens(content, sessionId);

    // Parse human input from user.message events
    const humanEntries = parseCopilotHumanMessages(content);

    // Upsert token entries. ON CONFLICT updates because resumed sessions produce
    // a second shutdown with cumulative (larger) token counts and the same messageId.
    const upsertStmt = db.prepare(`
      INSERT INTO token_usage
        (message_id, agent_session_id, project_dir, model,
         input_tokens, output_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
         cache_read_tokens, is_fast_mode, message_timestamp, date, provider, premium_requests)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'copilot', ?)
      ON CONFLICT(message_id) DO UPDATE SET
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_write_5m_tokens = excluded.cache_write_5m_tokens,
        cache_write_1h_tokens = excluded.cache_write_1h_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        premium_requests = excluded.premium_requests,
        message_timestamp = excluded.message_timestamp,
        date = excluded.date
    `);

    let newCount = 0;
    const insertAll = db.transaction(() => {
      for (const entry of tokenEntries) {
        const date = localDateStr(new Date(entry.timestamp));
        const result = upsertStmt.run(
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
          entry.premiumRequests,
        );
        if (result.changes > 0) newCount++;
      }
    });
    insertAll();

    // Insert human input entries
    inputTracker.insertBatch(humanEntries, sessionId, projectDir, 'copilot');

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
      VALUES (?, ?, ?, ?, ?, ?, 'copilot')
      ON CONFLICT(file_path) DO UPDATE SET
        last_scanned_offset = excluded.last_scanned_offset,
        file_size = excluded.file_size,
        last_scanned_at = excluded.last_scanned_at
    `).run(filePath, sessionId, projectDir, fileSize, fileSize, now);
  }
}

/** Extract cwd from the session.start event in already-read content (avoids re-reading file). */
function extractCwdFromContent(content: string): string {
  const firstLine = content.split('\n')[0]?.trim();
  if (!firstLine) return '';
  try {
    const event = JSON.parse(firstLine);
    if (event.type !== 'session.start') return '';
    return event.data?.context?.cwd ?? '';
  } catch {
    return '';
  }
}
