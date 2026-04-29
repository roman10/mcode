// --- Token Usage ---

import type { AgentSessionType } from './session-agents';

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
}

export interface ModelUsageSummary {
  model: string;
  modelFamily: string;
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
}

/**
 * Effective context occupancy at the moment of the latest assistant turn.
 * `usedTokens` mirrors what Claude Code's own UI reports: the input-side
 * tokens of the latest assistant message (input + cache writes + cache read).
 *
 * `null` when the session has no assistant messages yet, when the latest
 * marker in the transcript is a `/compact` summary (the next turn will be
 * post-compact), or when a `/clear` rotated to a new session id with no
 * data yet. The badge hides in those cases rather than showing stale data.
 */
export interface CurrentContextUsage {
  model: string;
  usedTokens: number;
  contextWindow: number | null;
  percent: number | null;
}

export interface SessionTokenUsage {
  claudeSessionId: string;
  models: ModelUsageSummary[];
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  currentContext: CurrentContextUsage | null;
}

export interface ProviderUsageSummary {
  provider: AgentSessionType;
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
  premiumRequests: number;
}

export interface DailyTokenUsage {
  date: string;
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
  premiumRequests: number;
  byModel: ModelUsageSummary[];
  byProvider: ProviderUsageSummary[];
  topSessions: Array<{
    sessionId: string;
    provider: AgentSessionType;
    label: string | null;
    estimatedCostUsd: number;
    outputTokens: number;
  }>;
}

export interface ModelTokenBreakdown {
  model: string;
  modelFamily: string;
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
  pctOfTotalCost: number;
}

export interface TokenWeeklyTrend {
  thisWeek: { outputTokens: number; estimatedCostUsd: number; messageCount: number };
  lastWeek: { outputTokens: number; estimatedCostUsd: number; messageCount: number };
  pctChange: number | null;
}

export interface TokenHeatmapEntry {
  date: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  messageCount: number;
}
