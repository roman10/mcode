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

import { stat, readFile } from 'node:fs/promises';
import { getDb } from '../db';
import { logger } from '../logger';
import { parseCodexTranscript } from './codex-transcript-parser';
import { iterateCodexRolloutFiles } from './codex-rollout-files';
import { localDateStr } from './date-utils';
import type { InputTracker } from './input-tracker';

export class CodexScanner {
  /**
   * @param resolveSessionsDirs - Returns absolute paths to every account's
   *   `.codex/sessions/` dir that exists on disk. Must enumerate across
   *   default + secondary accounts.
   */
  constructor(private resolveSessionsDirs: () => string[]) {}

  /**
   * Scan all Codex transcript directories for session JSONL files.
   * Returns total number of new token_usage entries inserted.
   */
  async scanAll(inputTracker: InputTracker): Promise<number> {
    const sessionsDirs = this.resolveSessionsDirs();

    let totalNew = 0;
    for (const sessionsDir of sessionsDirs) {
      totalNew += await this.scanSessionsDir(sessionsDir, inputTracker);
    }

    if (totalNew > 0) {
      logger.info('codex-scanner', `Scan complete, ${totalNew} new entries`);
    }

    return totalNew;
  }

  private async scanSessionsDir(sessionsDir: string, inputTracker: InputTracker): Promise<number> {
    let newCount = 0;
    for await (const filePath of iterateCodexRolloutFiles(sessionsDir)) {
      try {
        newCount += await this.scanFile(filePath, inputTracker);
      } catch {
        // Skip individual file errors
      }
    }
    return newCount;
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
         cache_read_tokens, is_fast_mode, message_timestamp, date, context_window, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'codex')
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
          entry.contextWindow ?? null,
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
