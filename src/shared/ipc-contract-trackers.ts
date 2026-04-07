import type {
  CommitCadenceInfo,
  CommitHeatmapEntry,
  CommitStreakInfo,
  CommitWeeklyTrend,
  DailyCommitStats,
  DailyInputStats,
  DailyTokenUsage,
  InputCadenceInfo,
  InputHeatmapEntry,
  InputWeeklyTrend,
  ModelTokenBreakdown,
  PromptHistoryEntry,
  QuotaSnapshot,
  SessionTokenUsage,
  TokenHeatmapEntry,
  TokenWeeklyTrend,
} from './types';

// ---------------------------------------------------------------------------
// Tokens, Commits, and Input tracker IPC channels
// ---------------------------------------------------------------------------

export interface TrackersInvokeContract {
  // --- Tokens ---
  'tokens:get-session-usage':           { params: [sessionId: string]; result: SessionTokenUsage };
  'tokens:get-daily-usage':             { params: [date?: string, provider?: string]; result: DailyTokenUsage };
  'tokens:get-model-breakdown':         { params: [days?: number, provider?: string]; result: ModelTokenBreakdown[] };
  'tokens:get-weekly-trend':            { params: [provider?: string]; result: TokenWeeklyTrend };
  'tokens:get-heatmap':                 { params: [days?: number, provider?: string]; result: TokenHeatmapEntry[] };
  'tokens:refresh':                     { params: []; result: void };
  'quota:list':                         { params: [forceRefresh?: boolean]; result: QuotaSnapshot[] };

  // --- Input ---
  'input:get-daily-stats':              { params: [date?: string, provider?: string]; result: DailyInputStats };
  'input:get-heatmap':                  { params: [days?: number, provider?: string]; result: InputHeatmapEntry[] };
  'input:get-weekly-trend':             { params: [provider?: string]; result: InputWeeklyTrend };
  'input:get-cadence':                  { params: [date?: string, provider?: string]; result: InputCadenceInfo };

  // --- Prompt History ---
  'prompt-history:search':              { params: [query: string, limit?: number]; result: PromptHistoryEntry[] };
  'prompt-history:recent':              { params: [limit?: number]; result: PromptHistoryEntry[] };
  'prompt-history:delete':              { params: [id: number]; result: void };
  'prompt-history:toggle-pin':          { params: [id: number]; result: void };

  // --- Commits ---
  'commits:get-daily-stats':            { params: [date?: string, provider?: string]; result: DailyCommitStats };
  'commits:get-heatmap':                { params: [days?: number, provider?: string]; result: CommitHeatmapEntry[] };
  'commits:get-streaks':                { params: [provider?: string]; result: CommitStreakInfo };
  'commits:get-cadence':                { params: [date?: string, provider?: string]; result: CommitCadenceInfo };
  'commits:get-weekly-trend':           { params: [provider?: string]; result: CommitWeeklyTrend };
  'commits:refresh':                    { params: []; result: void };
  'commits:force-rescan':               { params: []; result: void };
}

export interface TrackersPushContract {
  'commits:updated':                    { params: [] };
  'tokens:updated':                     { params: [] };
}
