import { statSync } from 'node:fs';
import { readdir, stat, open as fsOpen } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { WebContents } from 'electron';
import { getDb } from './db';
import { logger } from './logger';
import { parseUsageFromChunk, parseHumanMessagesFromChunk } from './jsonl-usage-parser';
import type { InputTracker } from './input-tracker';
import { estimateCostUsd, normalizeModelFamily } from './token-cost';
import type {
  HookEvent,
  SessionTokenUsage,
  DailyTokenUsage,
  ModelTokenBreakdown,
  TokenWeeklyTrend,
  TokenHeatmapEntry,
  TokenTotals,
  ModelUsageSummary,
} from '../shared/types';
import { typedHandle } from './ipc-helpers';

const BACKGROUND_POLL_MS = 5 * 60 * 1000; // 5 minutes
const SCAN_BATCH_SIZE = 20;
const HOOK_SCAN_DELAY_MS = 500;

interface TrackedFileRecord {
  file_path: string;
  claude_session_id: string;
  project_dir: string;
  last_scanned_offset: number;
  file_size: number;
}

/** Common shape for all token aggregation queries (GROUP BY model, is_fast_mode). */
interface TokenAggRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  cache_read_tokens: number;
  is_fast_mode: number;
  message_count: number;
}

interface UsageRow extends TokenAggRow {
  first_ts: string | null;
  last_ts: string | null;
}

interface HeatmapRow {
  date: string;
  output_tokens: number;
  message_count: number;
  input_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  cache_read_tokens: number;
}

interface WeekRow {
  output_tokens: number;
  message_count: number;
  input_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  cache_read_tokens: number;
}

export class TokenTracker {
  private getWebContents: () => WebContents | null;
  private inputTracker: InputTracker;
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor(getWebContents: () => WebContents | null, inputTracker: InputTracker) {
    this.getWebContents = getWebContents;
    this.inputTracker = inputTracker;
  }

  start(): void {
    this.scanAll().catch((err) => {
      logger.warn('tokens', 'Initial scan failed', { error: String(err) });
    });

    this.backgroundTimer = setInterval(() => {
      this.scanAll().catch((err) => {
        logger.warn('tokens', 'Background scan failed', { error: String(err) });
      });
    }, BACKGROUND_POLL_MS);
  }

  stop(): void {
    if (this.backgroundTimer) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = null;
    }
  }

  /** Handle hook events — scan the transcript on Stop events. */
  async onHookEvent(_sessionId: string, event: HookEvent): Promise<void> {
    if (event.hookEventName !== 'Stop') return;

    const payload = event.payload as { transcript_path?: string } | undefined;
    const transcriptPath = payload?.transcript_path;
    if (!transcriptPath) return;

    setTimeout(() => {
      this.scanFile(transcriptPath).catch((err) => {
        logger.warn('tokens', 'Hook-triggered scan failed', { error: String(err) });
      });
    }, HOOK_SCAN_DELAY_MS);
  }

  /** Scan all ~/.claude/projects/ directories for JSONL files. */
  async scanAll(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;

    try {
      const projectsDir = join(homedir(), '.claude', 'projects');
      let projectDirs: string[];
      try {
        projectDirs = await readdir(projectsDir);
      } catch {
        return; // ~/.claude/projects/ doesn't exist
      }

      const allFiles: string[] = [];
      for (const proj of projectDirs) {
        const projPath = join(projectsDir, proj);
        try {
          const files = await readdir(projPath);
          for (const f of files) {
            if (f.endsWith('.jsonl')) {
              allFiles.push(join(projPath, f));
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
            const count = await this.scanFile(filePath);
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

      if (totalNew > 0) {
        logger.info('tokens', `Scan complete, ${totalNew} new entries from ${allFiles.length} files`);
        this.broadcastUpdate();
      }
    } finally {
      this.scanning = false;
    }
  }

  /** Scan a single JSONL file incrementally. Returns count of new entries inserted. */
  async scanFile(filePath: string): Promise<number> {
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

      if (entries.length === 0 && humanEntries.length === 0) {
        // Update watermark even if no entries (file grew but no usage data)
        this.updateWatermark(filePath, fileSize);
        return 0;
      }

      // Derive session ID and project dir from file path
      const fileName = basename(filePath, '.jsonl');
      const projectDir = basename(dirname(filePath));

      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO token_usage
          (message_id, claude_session_id, project_dir, model,
           input_tokens, output_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
           cache_read_tokens, is_fast_mode, message_timestamp, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      });
      insertAll();

      // Insert human input entries via InputTracker
      this.inputTracker.insertBatch(humanEntries, fileName, projectDir);

      this.updateWatermark(filePath, fileSize, fileName, projectDir);

      if (newCount > 0) {
        this.broadcastUpdate();
      }

      return newCount;
    } finally {
      await fh.close();
    }
  }

  // --- Query methods ---

  getSessionUsage(claudeSessionId: string): SessionTokenUsage {
    const db = getDb();

    const rows = db.prepare(`
      SELECT model,
             SUM(input_tokens) as input_tokens,
             SUM(output_tokens) as output_tokens,
             SUM(cache_write_5m_tokens) as cache_write_5m_tokens,
             SUM(cache_write_1h_tokens) as cache_write_1h_tokens,
             SUM(cache_read_tokens) as cache_read_tokens,
             is_fast_mode,
             COUNT(*) as message_count,
             MIN(message_timestamp) as first_ts,
             MAX(message_timestamp) as last_ts
      FROM token_usage
      WHERE claude_session_id = ?
      GROUP BY model, is_fast_mode
    `).all(claudeSessionId) as UsageRow[];

    const models = buildModelSummaries(rows);

    const totals = sumTotals(models.map((m) => m.totals));
    const totalCost = models.reduce((acc, m) => acc + m.estimatedCostUsd, 0);
    const totalMessages = models.reduce((acc, m) => acc + m.messageCount, 0);

    let firstMessageAt: string | null = null;
    let lastMessageAt: string | null = null;
    for (const r of rows) {
      if (r.first_ts && (!firstMessageAt || r.first_ts < firstMessageAt)) firstMessageAt = r.first_ts;
      if (r.last_ts && (!lastMessageAt || r.last_ts > lastMessageAt)) lastMessageAt = r.last_ts;
    }

    return {
      claudeSessionId,
      models,
      totals,
      estimatedCostUsd: totalCost,
      messageCount: totalMessages,
      firstMessageAt,
      lastMessageAt,
    };
  }

  getDailyUsage(date?: string): DailyTokenUsage {
    const db = getDb();
    const targetDate = date ?? localDateStr(new Date());

    const rows = db.prepare(`
      SELECT model,
             SUM(input_tokens) as input_tokens,
             SUM(output_tokens) as output_tokens,
             SUM(cache_write_5m_tokens) as cache_write_5m_tokens,
             SUM(cache_write_1h_tokens) as cache_write_1h_tokens,
             SUM(cache_read_tokens) as cache_read_tokens,
             is_fast_mode,
             COUNT(*) as message_count
      FROM token_usage
      WHERE date = ?
      GROUP BY model, is_fast_mode
    `).all(targetDate) as TokenAggRow[];

    const byModel = buildModelSummaries(rows);

    // Top sessions by output tokens
    const topSessionIds = db.prepare(`
      SELECT claude_session_id,
             SUM(output_tokens) as output_tokens
      FROM token_usage
      WHERE date = ?
      GROUP BY claude_session_id
      ORDER BY output_tokens DESC
      LIMIT 5
    `).all(targetDate) as { claude_session_id: string; output_tokens: number }[];

    // Compute accurate per-session cost across all models used in each session
    const getLabel = db.prepare(
      'SELECT label FROM sessions WHERE claude_session_id = ?',
    );
    const getSessionModels = db.prepare(`
      SELECT model,
             SUM(input_tokens) as input_tokens,
             SUM(output_tokens) as output_tokens,
             SUM(cache_write_5m_tokens) as cache_write_5m_tokens,
             SUM(cache_write_1h_tokens) as cache_write_1h_tokens,
             SUM(cache_read_tokens) as cache_read_tokens,
             is_fast_mode,
             COUNT(*) as message_count
      FROM token_usage
      WHERE date = ? AND claude_session_id = ?
      GROUP BY model, is_fast_mode
    `);

    const topSessions = topSessionIds.map((r) => {
      const labelRow = getLabel.get(r.claude_session_id) as { label: string } | undefined;
      const modelRows = getSessionModels.all(targetDate, r.claude_session_id) as TokenAggRow[];
      let sessionCost = 0;
      for (const m of modelRows) {
        sessionCost += estimateCostForTotals(m.model, rowToTotals(m), m.is_fast_mode === 1);
      }
      return {
        claudeSessionId: r.claude_session_id,
        label: labelRow?.label ?? null,
        estimatedCostUsd: sessionCost,
        outputTokens: r.output_tokens,
      };
    });

    const totals = sumTotals(byModel.map((m) => m.totals));
    const totalCost = byModel.reduce((acc, m) => acc + m.estimatedCostUsd, 0);
    const totalMessages = byModel.reduce((acc, m) => acc + m.messageCount, 0);

    return {
      date: targetDate,
      totals,
      estimatedCostUsd: totalCost,
      messageCount: totalMessages,
      byModel,
      topSessions,
    };
  }

  getModelBreakdown(days = 30): ModelTokenBreakdown[] {
    const db = getDb();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    const startDateStr = localDateStr(startDate);

    const rows = db.prepare(`
      SELECT model,
             SUM(input_tokens) as input_tokens,
             SUM(output_tokens) as output_tokens,
             SUM(cache_write_5m_tokens) as cache_write_5m_tokens,
             SUM(cache_write_1h_tokens) as cache_write_1h_tokens,
             SUM(cache_read_tokens) as cache_read_tokens,
             is_fast_mode,
             COUNT(*) as message_count
      FROM token_usage
      WHERE date >= ?
      GROUP BY model, is_fast_mode
      ORDER BY output_tokens DESC
    `).all(startDateStr) as TokenAggRow[];

    const summaries = buildModelSummaries(rows);
    const items: ModelTokenBreakdown[] = summaries.map((s) => ({
      ...s,
      pctOfTotalCost: 0,
    }));

    const totalCost = items.reduce((acc, i) => acc + i.estimatedCostUsd, 0);
    if (totalCost > 0) {
      for (const item of items) {
        item.pctOfTotalCost = Math.round((item.estimatedCostUsd / totalCost) * 10000) / 100;
      }
    }

    return items;
  }

  getWeeklyTrend(): TokenWeeklyTrend {
    const db = getDb();

    const thisWeekRow = db.prepare(`
      SELECT COALESCE(SUM(output_tokens), 0) as output_tokens,
             COUNT(*) as message_count,
             COALESCE(SUM(input_tokens), 0) as input_tokens,
             COALESCE(SUM(cache_write_5m_tokens), 0) as cache_write_5m_tokens,
             COALESCE(SUM(cache_write_1h_tokens), 0) as cache_write_1h_tokens,
             COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
      FROM token_usage
      WHERE date >= date('now', 'localtime', 'weekday 0', '-6 days')
    `).get() as WeekRow;

    const lastWeekRow = db.prepare(`
      SELECT COALESCE(SUM(output_tokens), 0) as output_tokens,
             COUNT(*) as message_count,
             COALESCE(SUM(input_tokens), 0) as input_tokens,
             COALESCE(SUM(cache_write_5m_tokens), 0) as cache_write_5m_tokens,
             COALESCE(SUM(cache_write_1h_tokens), 0) as cache_write_1h_tokens,
             COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
      FROM token_usage
      WHERE date >= date('now', 'localtime', 'weekday 0', '-13 days')
        AND date < date('now', 'localtime', 'weekday 0', '-6 days')
    `).get() as WeekRow;

    // Estimate cost for each week (rough — uses average model pricing)
    const thisWeekCost = estimateWeekCost(db, "date >= date('now', 'localtime', 'weekday 0', '-6 days')");
    const lastWeekCost = estimateWeekCost(db, "date >= date('now', 'localtime', 'weekday 0', '-13 days') AND date < date('now', 'localtime', 'weekday 0', '-6 days')");

    const pctChange = lastWeekRow.output_tokens > 0
      ? Math.round(((thisWeekRow.output_tokens - lastWeekRow.output_tokens) / lastWeekRow.output_tokens) * 100)
      : null;

    return {
      thisWeek: {
        outputTokens: thisWeekRow.output_tokens,
        estimatedCostUsd: thisWeekCost,
        messageCount: thisWeekRow.message_count,
      },
      lastWeek: {
        outputTokens: lastWeekRow.output_tokens,
        estimatedCostUsd: lastWeekCost,
        messageCount: lastWeekRow.message_count,
      },
      pctChange,
    };
  }

  getHeatmap(days = 7): TokenHeatmapEntry[] {
    const db = getDb();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    const startDateStr = localDateStr(startDate);

    const rows = db.prepare(`
      SELECT date,
             COALESCE(SUM(output_tokens), 0) as output_tokens,
             COUNT(*) as message_count,
             COALESCE(SUM(input_tokens), 0) as input_tokens,
             COALESCE(SUM(cache_write_5m_tokens), 0) as cache_write_5m_tokens,
             COALESCE(SUM(cache_write_1h_tokens), 0) as cache_write_1h_tokens,
             COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
      FROM token_usage
      WHERE date >= ?
      GROUP BY date
      ORDER BY date ASC
    `).all(startDateStr) as HeatmapRow[];

    // Compute per-day costs by querying model breakdown per day
    const dayCosts = new Map<string, number>();
    for (const row of rows) {
      const dayModels = db.prepare(`
        SELECT model,
               SUM(input_tokens) as input_tokens,
               SUM(output_tokens) as output_tokens,
               SUM(cache_write_5m_tokens) as cache_write_5m_tokens,
               SUM(cache_write_1h_tokens) as cache_write_1h_tokens,
               SUM(cache_read_tokens) as cache_read_tokens,
               is_fast_mode,
               COUNT(*) as message_count
        FROM token_usage WHERE date = ? GROUP BY model, is_fast_mode
      `).all(row.date) as TokenAggRow[];

      let cost = 0;
      for (const m of dayModels) {
        cost += estimateCostForTotals(m.model, rowToTotals(m), m.is_fast_mode === 1);
      }
      dayCosts.set(row.date, cost);
    }

    // Fill missing days with zeros
    const result: TokenHeatmapEntry[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = localDateStr(d);
      const existing = rows.find((r) => r.date === dateStr);
      result.push({
        date: dateStr,
        outputTokens: existing?.output_tokens ?? 0,
        estimatedCostUsd: dayCosts.get(dateStr) ?? 0,
        messageCount: existing?.message_count ?? 0,
      });
    }

    return result;
  }

  /** Remove watermarks for JSONL files that no longer exist on disk. */
  pruneStaleTrackedFiles(): void {
    const db = getDb();
    const tracked = db.prepare('SELECT file_path FROM tracked_jsonl_files').all() as { file_path: string }[];
    for (const { file_path } of tracked) {
      try {
        statSync(file_path);
      } catch {
        db.prepare('DELETE FROM tracked_jsonl_files WHERE file_path = ?').run(file_path);
      }
    }
  }

  // --- Private helpers ---

  private updateWatermark(
    filePath: string,
    fileSize: number,
    claudeSessionId?: string,
    projectDir?: string,
  ): void {
    const db = getDb();
    const sessionId = claudeSessionId ?? basename(filePath, '.jsonl');
    const projDir = projectDir ?? basename(dirname(filePath));
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO tracked_jsonl_files (file_path, claude_session_id, project_dir, last_scanned_offset, file_size, last_scanned_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        last_scanned_offset = excluded.last_scanned_offset,
        file_size = excluded.file_size,
        last_scanned_at = excluded.last_scanned_at
    `).run(filePath, sessionId, projDir, fileSize, fileSize, now);
  }

  private broadcastUpdate(): void {
    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('tokens:updated');
    }
  }
}

// --- Utility functions ---

function rowToTotals(r: {
  input_tokens: number;
  output_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
  cache_read_tokens: number;
}): TokenTotals {
  return {
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheWrite5mTokens: r.cache_write_5m_tokens,
    cacheWrite1hTokens: r.cache_write_1h_tokens,
    cacheReadTokens: r.cache_read_tokens,
  };
}

function sumTotals(items: TokenTotals[]): TokenTotals {
  const result: TokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
  };
  for (const t of items) {
    result.inputTokens += t.inputTokens;
    result.outputTokens += t.outputTokens;
    result.cacheWrite5mTokens += t.cacheWrite5mTokens;
    result.cacheWrite1hTokens += t.cacheWrite1hTokens;
    result.cacheReadTokens += t.cacheReadTokens;
  }
  return result;
}

/**
 * Build ModelUsageSummary[] from rows grouped by (model, is_fast_mode).
 * Computes per-row cost with the correct fast-mode multiplier, then merges
 * rows with the same model into a single summary.
 */
function buildModelSummaries(rows: TokenAggRow[]): ModelUsageSummary[] {
  const byModel = new Map<string, ModelUsageSummary>();
  for (const r of rows) {
    const totals = rowToTotals(r);
    const cost = estimateCostForTotals(r.model, totals, r.is_fast_mode === 1);
    const existing = byModel.get(r.model);
    if (existing) {
      existing.totals = sumTotals([existing.totals, totals]);
      existing.estimatedCostUsd += cost;
      existing.messageCount += r.message_count;
    } else {
      byModel.set(r.model, {
        model: r.model,
        modelFamily: normalizeModelFamily(r.model),
        totals,
        estimatedCostUsd: cost,
        messageCount: r.message_count,
      });
    }
  }
  return Array.from(byModel.values());
}

function estimateCostForTotals(model: string, totals: TokenTotals, isFastMode: boolean): number {
  return estimateCostUsd(
    model,
    totals.inputTokens,
    totals.outputTokens,
    totals.cacheWrite5mTokens,
    totals.cacheWrite1hTokens,
    totals.cacheReadTokens,
    isFastMode,
  );
}

function estimateWeekCost(db: ReturnType<typeof getDb>, whereClause: string): number {
  const rows = db.prepare(`
    SELECT model,
           SUM(input_tokens) as input_tokens,
           SUM(output_tokens) as output_tokens,
           SUM(cache_write_5m_tokens) as cache_write_5m_tokens,
           SUM(cache_write_1h_tokens) as cache_write_1h_tokens,
           SUM(cache_read_tokens) as cache_read_tokens,
           is_fast_mode,
           COUNT(*) as message_count
    FROM token_usage
    WHERE ${whereClause}
    GROUP BY model, is_fast_mode
  `).all() as TokenAggRow[];

  let cost = 0;
  for (const r of rows) {
    cost += estimateCostForTotals(r.model, rowToTotals(r), r.is_fast_mode === 1);
  }
  return cost;
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function registerTokenIpc(tokenTracker: TokenTracker): void {
  typedHandle('tokens:get-session-usage', (claudeSessionId) => {
    return tokenTracker.getSessionUsage(claudeSessionId);
  });

  typedHandle('tokens:get-daily-usage', (date) => {
    return tokenTracker.getDailyUsage(date);
  });

  typedHandle('tokens:get-model-breakdown', (days) => {
    return tokenTracker.getModelBreakdown(days);
  });

  typedHandle('tokens:get-weekly-trend', () => {
    return tokenTracker.getWeeklyTrend();
  });

  typedHandle('tokens:get-heatmap', (days) => {
    return tokenTracker.getHeatmap(days);
  });

  typedHandle('tokens:refresh', async () => {
    await tokenTracker.scanAll();
  });
}
