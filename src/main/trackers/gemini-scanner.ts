/**
 * Scanner for Gemini CLI transcript JSON files.
 *
 * Discovers session transcripts in ~/.gemini/tmp/ and parses them for token
 * usage and human input data. Uses the same watermark table as other scanners.
 *
 * Unlike Claude (incremental JSONL), Gemini transcripts are single JSON files
 * that must be read in full. The watermark tracks file_size to skip unchanged files.
 */

import { readdir, stat, readFile } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { getDb } from '../db';
import { logger } from '../logger';
import { parseGeminiTranscriptTokens, parseGeminiTranscriptHumanMessages } from './gemini-transcript-parser';
import { localDateStr } from './date-utils';
import type { InputTracker } from './input-tracker';

export class GeminiScanner {
  /**
   * @param resolveTmpDirs - Returns absolute paths to every account's
   *   `.gemini/tmp/` dir. When omitted, falls back to the default home only.
   */
  constructor(private resolveTmpDirs?: () => string[]) {}

  /**
   * Scan all Gemini transcript directories for session JSON files.
   * Returns total number of new token_usage entries inserted.
   */
  async scanAll(inputTracker: InputTracker): Promise<number> {
    const tmpDirs = this.resolveTmpDirs?.() ?? [join(homedir(), '.gemini', 'tmp')];

    let totalNew = 0;
    for (const tmpDir of tmpDirs) {
      totalNew += await this.scanTmpDir(tmpDir, inputTracker);
    }

    if (totalNew > 0) {
      logger.info('gemini-scanner', `Scan complete, ${totalNew} new entries`);
    }

    return totalNew;
  }

  private async scanTmpDir(tmpDir: string, inputTracker: InputTracker): Promise<number> {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(tmpDir);
    } catch {
      return 0; // tmp dir doesn't exist
    }

    let newCount = 0;
    for (const proj of projectDirs) {
      const chatsDir = join(tmpDir, proj, 'chats');
      let files: string[];
      try {
        files = await readdir(chatsDir);
      } catch {
        continue; // No chats directory
      }

      for (const file of files) {
        if (!file.startsWith('session-') || !file.endsWith('.json')) continue;
        const filePath = join(chatsDir, file);
        try {
          newCount += await this.scanFile(filePath, inputTracker);
        } catch {
          // Skip individual file errors
        }
      }
    }

    return newCount;
  }

  /**
   * Scan a single Gemini transcript JSON file.
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

    // Read full file (Gemini transcripts are JSON, not streaming JSONL)
    const content = await readFile(filePath, 'utf-8');

    // Extract session ID from transcript content
    let transcriptSessionId: string;
    try {
      const parsed = JSON.parse(content) as { sessionId?: string };
      transcriptSessionId = parsed.sessionId ?? basename(filePath, '.json');
    } catch {
      transcriptSessionId = basename(filePath, '.json');
    }

    // Derive project dir from path: ~/.gemini/tmp/<projectDir>/chats/<file>
    const projectDir = basename(dirname(dirname(filePath)));

    // Parse token usage and human input
    const tokenEntries = parseGeminiTranscriptTokens(content, transcriptSessionId);
    const humanEntries = parseGeminiTranscriptHumanMessages(content);

    // Upsert token entries. ON CONFLICT updates because we re-read the full file
    // on each scan — token counts may grow as the session progresses.
    const upsertStmt = db.prepare(`
      INSERT INTO token_usage
        (message_id, agent_session_id, project_dir, model,
         input_tokens, output_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
         cache_read_tokens, is_fast_mode, message_timestamp, date, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gemini')
      ON CONFLICT(message_id) DO UPDATE SET
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        message_timestamp = excluded.message_timestamp,
        date = excluded.date
    `);

    let newCount = 0;
    const insertAll = db.transaction(() => {
      for (const entry of tokenEntries) {
        const date = localDateStr(new Date(entry.timestamp));
        const result = upsertStmt.run(
          entry.messageId,
          transcriptSessionId,
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
    inputTracker.insertBatch(humanEntries, transcriptSessionId, projectDir, 'gemini');

    // Update watermark
    this.updateWatermark(filePath, fileSize, transcriptSessionId, projectDir);

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
      VALUES (?, ?, ?, ?, ?, ?, 'gemini')
      ON CONFLICT(file_path) DO UPDATE SET
        last_scanned_offset = excluded.last_scanned_offset,
        file_size = excluded.file_size,
        last_scanned_at = excluded.last_scanned_at
    `).run(filePath, sessionId, projectDir, fileSize, fileSize, now);
  }
}
