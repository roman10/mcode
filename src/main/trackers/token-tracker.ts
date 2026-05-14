import { statSync } from 'node:fs';
import type { WebContents } from 'electron';
import { getDb } from '../db';
import { logger } from '../logger';
import type { InputTracker } from './input-tracker';
import { estimateCostUsd, normalizeModelFamily } from './token-cost';
import { getContextWindow, setClaudeConfigPathsProvider } from './model-context';
import { localDateStr, enumerateDates } from './date-utils';
import type {
  HookEvent,
  SessionTokenUsage,
  CurrentContextUsage,
  DailyTokenUsage,
  ModelTokenBreakdown,
  TokenWeeklyTrend,
  TokenHeatmapEntry,
  TokenTotals,
  ModelUsageSummary,
} from '../../shared/types';
import type { AgentSessionType } from '../../shared/session-agents';
import { ClaudeScanner } from './claude-scanner';
import { CopilotScanner } from './copilot-scanner';
import { GeminiScanner } from './gemini-scanner';
import { CodexScanner } from './codex-scanner';
import type { AccountService } from '../accounts';

const BACKGROUND_POLL_MS = 5 * 60 * 1000; // 5 minutes
const HOOK_SCAN_DELAY_MS = 500;

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

interface HeatmapModelRow extends TokenAggRow {
  date: string;
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
  private claudeScanner = new ClaudeScanner();
  private copilotScanner: CopilotScanner;
  private geminiScanner: GeminiScanner;
  private codexScanner: CodexScanner;
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor(
    getWebContents: () => WebContents | null,
    inputTracker: InputTracker,
    accountService: AccountService,
  ) {
    this.getWebContents = getWebContents;
    this.inputTracker = inputTracker;
    // Env-var-isolated providers (Copilot, Codex, Gemini) need per-account dir
    // enumeration; Claude uses HOME+symlink so its scanner doesn't.
    this.copilotScanner = new CopilotScanner(
      () => accountService.listAllAccountPaths('.copilot/session-state'),
    );
    this.codexScanner = new CodexScanner(
      () => accountService.listAllAccountPaths('.codex/sessions'),
    );
    this.geminiScanner = new GeminiScanner(
      () => accountService.listAllAccountPaths('.gemini/tmp'),
    );
    // Per-account `.claude.json` is the source of truth for 1M-tier detection
    // when the transcript model id lacks the "[1m]" suffix.
    setClaudeConfigPathsProvider(
      () => accountService.listAllAccountPaths('.claude/.claude.json'),
    );
  }

  /** Wire the Copilot scanner's model detection callback to the session manager. */
  setCopilotModelCallback(cb: (copilotSessionId: string, normalizedModel: string) => void): void {
    this.copilotScanner.onModelDetected = cb;
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

  /** Handle hook events — scan the transcript on Stop/SessionEnd events. */
  async onHookEvent(_sessionId: string, event: HookEvent, provider?: AgentSessionType): Promise<void> {
    // Copilot: trigger a full scan on SessionEnd to pick up shutdown data + model
    if (provider === 'copilot' && event.hookEventName === 'SessionEnd') {
      setTimeout(() => {
        this.copilotScanner.scanAll(this.inputTracker).then((count) => {
          if (count > 0) this.broadcastUpdate();
        }).catch((err) => {
          logger.warn('tokens', 'Copilot SessionEnd scan failed', { error: String(err) });
        });
      }, HOOK_SCAN_DELAY_MS);
      return;
    }

    if (event.hookEventName !== 'Stop') return;

    const payload = event.payload as { transcript_path?: string } | undefined;
    const transcriptPath = payload?.transcript_path;
    if (!transcriptPath) return;

    setTimeout(() => {
      const scanner = provider === 'codex' ? this.codexScanner
        : provider === 'gemini' ? this.geminiScanner
        : this.claudeScanner;
      scanner.scanFile(transcriptPath, this.inputTracker).then((count) => {
        if (count > 0) this.broadcastUpdate();
      }).catch((err) => {
        logger.warn('tokens', 'Hook-triggered scan failed', { error: String(err) });
      });
    }, HOOK_SCAN_DELAY_MS);
  }

  /** Scan all provider transcript directories. */
  async scanAll(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;

    try {
      let totalNew = 0;

      try {
        totalNew += await this.claudeScanner.scanAll(this.inputTracker);
      } catch (err) {
        logger.warn('tokens', 'Claude scan failed', { error: String(err) });
      }

      try {
        totalNew += await this.copilotScanner.scanAll(this.inputTracker);
      } catch (err) {
        logger.warn('tokens', 'Copilot scan failed', { error: String(err) });
      }

      try {
        totalNew += await this.geminiScanner.scanAll(this.inputTracker);
      } catch (err) {
        logger.warn('tokens', 'Gemini scan failed', { error: String(err) });
      }

      try {
        totalNew += await this.codexScanner.scanAll(this.inputTracker);
      } catch (err) {
        logger.warn('tokens', 'Codex scan failed', { error: String(err) });
      }

      if (totalNew > 0) {
        logger.info('tokens', `Scan complete, ${totalNew} new entries`);
        this.broadcastUpdate();
      }
    } finally {
      this.scanning = false;
    }
  }

  // --- Query methods ---

  getSessionUsage(sessionId: string): SessionTokenUsage {
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
      WHERE agent_session_id = ?
      GROUP BY model, is_fast_mode
    `).all(sessionId) as UsageRow[];

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
      claudeSessionId: sessionId,
      models,
      totals,
      estimatedCostUsd: totalCost,
      messageCount: totalMessages,
      firstMessageAt,
      lastMessageAt,
      currentContext: this.getCurrentContext(sessionId),
    };
  }

  /**
   * Compute the effective context occupancy for the session — the input-side
   * tokens of the latest assistant message, divided by the model's context
   * window. Returns null when:
   *   - there are no assistant messages yet (post-/clear, fresh session), or
   *   - the latest event in the transcript is a /compact summary (the badge
   *     should hide until the next assistant turn lands and reflects the
   *     compacted prompt's small input).
   */
  private getCurrentContext(sessionId: string): CurrentContextUsage | null {
    const db = getDb();

    const latest = db.prepare(`
      SELECT model,
             provider,
             input_tokens,
             cache_write_5m_tokens,
             cache_write_1h_tokens,
             cache_read_tokens,
             message_timestamp
        FROM token_usage
       WHERE agent_session_id = ?
       ORDER BY message_timestamp DESC
       LIMIT 1
    `).get(sessionId) as {
      model: string;
      provider: AgentSessionType;
      input_tokens: number;
      cache_write_5m_tokens: number;
      cache_write_1h_tokens: number;
      cache_read_tokens: number;
      message_timestamp: string;
    } | undefined;

    if (!latest) return null;

    // Suppress when a /compact marker post-dates the latest assistant turn.
    // Lookup is by the same id we use as agent_session_id for Claude rows.
    const compactRow = db.prepare(`
      SELECT last_compact_at FROM sessions
       WHERE claude_session_id = ?
    `).get(sessionId) as { last_compact_at: string | null } | undefined;
    const lastCompactAt = compactRow?.last_compact_at ?? null;
    if (lastCompactAt && lastCompactAt >= latest.message_timestamp) return null;

    const usedTokens =
      latest.input_tokens +
      latest.cache_write_5m_tokens +
      latest.cache_write_1h_tokens +
      latest.cache_read_tokens;

    const contextWindow = getContextWindow(latest.model, latest.provider);
    const percent = contextWindow ? Math.round((usedTokens / contextWindow) * 100) : null;

    return {
      model: latest.model,
      usedTokens,
      contextWindow,
      percent,
    };
  }

  getDailyUsage(date?: string, provider?: string): DailyTokenUsage {
    const db = getDb();
    const targetDate = date ?? localDateStr(new Date());
    const pf = providerFilter(provider);

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
      WHERE date = ?${pf.clause}
      GROUP BY model, is_fast_mode
    `).all(targetDate, ...pf.params) as TokenAggRow[];

    const byModel = buildModelSummaries(rows);

    // Top sessions by output tokens
    const topSessionIds = db.prepare(`
      SELECT agent_session_id,
             provider,
             SUM(output_tokens) as output_tokens
      FROM token_usage
      WHERE date = ?${pf.clause}
      GROUP BY agent_session_id
      ORDER BY output_tokens DESC
      LIMIT 5
    `).all(targetDate, ...pf.params) as { agent_session_id: string; provider: string; output_tokens: number }[];

    // Compute accurate per-session cost across all models used in each session.
    // Label lookup: try live session first, fall back to session_labels (survives deletion).
    const getLabelLive = db.prepare(`
      SELECT label FROM sessions
      WHERE CASE ? WHEN 'copilot' THEN copilot_session_id WHEN 'gemini' THEN gemini_session_id ELSE claude_session_id END = ?
    `);
    const getLabelArchived = db.prepare(
      'SELECT label FROM session_labels WHERE agent_session_id = ? AND provider = ?',
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
      WHERE date = ? AND agent_session_id = ?
      GROUP BY model, is_fast_mode
    `);

    const topSessions = topSessionIds.map((r) => {
      const labelRow = (getLabelLive.get(r.provider, r.agent_session_id) ??
        getLabelArchived.get(r.agent_session_id, r.provider)) as { label: string } | undefined;
      const modelRows = getSessionModels.all(targetDate, r.agent_session_id) as TokenAggRow[];
      let sessionCost = 0;
      for (const m of modelRows) {
        sessionCost += estimateCostForTotals(m.model, rowToTotals(m), m.is_fast_mode === 1);
      }
      return {
        sessionId: r.agent_session_id,
        provider: r.provider as AgentSessionType,
        label: labelRow?.label ?? null,
        estimatedCostUsd: sessionCost,
        outputTokens: r.output_tokens,
      };
    });

    const totals = sumTotals(byModel.map((m) => m.totals));
    const totalCost = byModel.reduce((acc, m) => acc + m.estimatedCostUsd, 0);
    const totalMessages = byModel.reduce((acc, m) => acc + m.messageCount, 0);

    // Premium requests (Copilot subscription units)
    const premRow = db.prepare(`
      SELECT COALESCE(SUM(premium_requests), 0) as total
      FROM token_usage WHERE date = ?${pf.clause}
    `).get(targetDate, ...pf.params) as { total: number };

    // Per-provider breakdown
    const providerRows = db.prepare(`
      SELECT provider,
             SUM(input_tokens) as input_tokens,
             SUM(output_tokens) as output_tokens,
             SUM(cache_write_5m_tokens) as cache_write_5m_tokens,
             SUM(cache_write_1h_tokens) as cache_write_1h_tokens,
             SUM(cache_read_tokens) as cache_read_tokens,
             COUNT(*) as message_count,
             COALESCE(SUM(premium_requests), 0) as premium_requests
      FROM token_usage
      WHERE date = ?${pf.clause}
      GROUP BY provider
    `).all(targetDate, ...pf.params) as (TokenAggRow & { provider: string; premium_requests: number })[];

    const byProvider = providerRows.map((pr) => {
      const prTotals = rowToTotals(pr);
      // Estimate cost using per-model breakdown for this provider
      const prModelRows = db.prepare(`
        SELECT model, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
               SUM(cache_write_5m_tokens) as cache_write_5m_tokens,
               SUM(cache_write_1h_tokens) as cache_write_1h_tokens,
               SUM(cache_read_tokens) as cache_read_tokens, is_fast_mode,
               COUNT(*) as message_count
        FROM token_usage WHERE date = ? AND provider = ?
        GROUP BY model, is_fast_mode
      `).all(targetDate, pr.provider) as TokenAggRow[];
      let prCost = 0;
      for (const m of prModelRows) {
        prCost += estimateCostForTotals(m.model, rowToTotals(m), m.is_fast_mode === 1);
      }
      return {
        provider: pr.provider as AgentSessionType,
        totals: prTotals,
        estimatedCostUsd: prCost,
        messageCount: pr.message_count,
        premiumRequests: pr.premium_requests,
      };
    });

    return {
      date: targetDate,
      totals,
      estimatedCostUsd: totalCost,
      messageCount: totalMessages,
      premiumRequests: premRow.total,
      byModel,
      byProvider,
      topSessions,
    };
  }

  getModelBreakdown(days = 30, provider?: string): ModelTokenBreakdown[] {
    const db = getDb();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    const startDateStr = localDateStr(startDate);
    const pf = providerFilter(provider);

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
      WHERE date >= ?${pf.clause}
      GROUP BY model, is_fast_mode
      ORDER BY output_tokens DESC
    `).all(startDateStr, ...pf.params) as TokenAggRow[];

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

  getWeeklyTrend(provider?: string): TokenWeeklyTrend {
    const db = getDb();
    const pf = providerFilter(provider);

    const thisWeekRow = db.prepare(`
      SELECT COALESCE(SUM(output_tokens), 0) as output_tokens,
             COUNT(*) as message_count,
             COALESCE(SUM(input_tokens), 0) as input_tokens,
             COALESCE(SUM(cache_write_5m_tokens), 0) as cache_write_5m_tokens,
             COALESCE(SUM(cache_write_1h_tokens), 0) as cache_write_1h_tokens,
             COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
      FROM token_usage
      WHERE date >= date('now', 'localtime', 'weekday 0', '-6 days')${pf.clause}
    `).get(...pf.params) as WeekRow;

    const lastWeekRow = db.prepare(`
      SELECT COALESCE(SUM(output_tokens), 0) as output_tokens,
             COUNT(*) as message_count,
             COALESCE(SUM(input_tokens), 0) as input_tokens,
             COALESCE(SUM(cache_write_5m_tokens), 0) as cache_write_5m_tokens,
             COALESCE(SUM(cache_write_1h_tokens), 0) as cache_write_1h_tokens,
             COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
      FROM token_usage
      WHERE date >= date('now', 'localtime', 'weekday 0', '-13 days')
        AND date < date('now', 'localtime', 'weekday 0', '-6 days')${pf.clause}
    `).get(...pf.params) as WeekRow;

    // Estimate cost for each week
    const thisWeekWhere = `date >= date('now', 'localtime', 'weekday 0', '-6 days')${pf.clause}`;
    const lastWeekWhere = `date >= date('now', 'localtime', 'weekday 0', '-13 days') AND date < date('now', 'localtime', 'weekday 0', '-6 days')${pf.clause}`;
    const thisWeekCost = estimateWeekCost(db, thisWeekWhere, pf.params);
    const lastWeekCost = estimateWeekCost(db, lastWeekWhere, pf.params);

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

  getHeatmap(
    startDateStr: string,
    endDateStr: string,
    provider?: string,
    fillEmptyDays = true,
  ): TokenHeatmapEntry[] {
    const db = getDb();
    const pf = providerFilter(provider);

    // Single query: per-day, per-model, per-is_fast_mode rollup. Avoids the
    // previous N+1 (one model-breakdown query per day) so multi-year ranges
    // are feasible.
    const rows = db.prepare(`
      SELECT date, model, is_fast_mode,
             COALESCE(SUM(input_tokens), 0) as input_tokens,
             COALESCE(SUM(output_tokens), 0) as output_tokens,
             COALESCE(SUM(cache_write_5m_tokens), 0) as cache_write_5m_tokens,
             COALESCE(SUM(cache_write_1h_tokens), 0) as cache_write_1h_tokens,
             COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
             COUNT(*) as message_count
      FROM token_usage
      WHERE date BETWEEN ? AND ?${pf.clause}
      GROUP BY date, model, is_fast_mode
    `).all(startDateStr, endDateStr, ...pf.params) as HeatmapModelRow[];

    // Aggregate per-date in JS using existing cost helpers.
    const byDate = new Map<string, TokenHeatmapEntry>();
    for (const r of rows) {
      const cost = estimateCostForTotals(r.model, rowToTotals(r), r.is_fast_mode === 1);
      const existing = byDate.get(r.date);
      const inputAll = r.input_tokens + r.cache_write_5m_tokens + r.cache_write_1h_tokens + r.cache_read_tokens;
      if (existing) {
        existing.inputTokens += inputAll;
        existing.outputTokens += r.output_tokens;
        existing.estimatedCostUsd += cost;
        existing.messageCount += r.message_count;
      } else {
        byDate.set(r.date, {
          date: r.date,
          inputTokens: inputAll,
          outputTokens: r.output_tokens,
          estimatedCostUsd: cost,
          messageCount: r.message_count,
        });
      }
    }

    if (!fillEmptyDays) {
      return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    }

    return enumerateDates(startDateStr, endDateStr).map((date) =>
      byDate.get(date) ?? {
        date,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        messageCount: 0,
      },
    );
  }

  /** Remove watermarks for tracked files that no longer exist on disk. */
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

  private broadcastUpdate(): void {
    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('tokens:updated');
    }
  }
}

// Re-export for backward compatibility
export { extractSessionMetadata } from './claude-scanner';

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

function estimateWeekCost(db: ReturnType<typeof getDb>, whereClause: string, extraParams: unknown[] = []): number {
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
  `).all(...extraParams) as TokenAggRow[];

  let cost = 0;
  for (const r of rows) {
    cost += estimateCostForTotals(r.model, rowToTotals(r), r.is_fast_mode === 1);
  }
  return cost;
}

/** Build optional provider WHERE clause fragment. */
function providerFilter(provider?: string): { clause: string; params: unknown[] } {
  return provider ? { clause: ' AND provider = ?', params: [provider] } : { clause: '', params: [] };
}
