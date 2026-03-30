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

export interface SessionTokenUsage {
  sessionId: string;
  models: ModelUsageSummary[];
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
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
  outputTokens: number;
  estimatedCostUsd: number;
  messageCount: number;
}
