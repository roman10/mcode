import type {
  CommitCadenceInfo,
  CommitHeatmapEntry,
  CommitStreakInfo,
  DailyCommitStats,
  DailyInputStats,
  DailyTokenUsage,
  InputCadenceInfo,
  InputHeatmapEntry,
  ModelTokenBreakdown,
  PromptHistoryEntry,
  QuotaSnapshot,
  SessionTokenUsage,
  ShellHistoryEntry,
  TokenHeatmapEntry,
} from './types';

// ---------------------------------------------------------------------------
// Tokens, Commits, and Input tracker IPC channels
// ---------------------------------------------------------------------------

export interface TrackersInvokeContract {
  // --- Tokens ---
  'tokens:get-session-usage':           { params: [sessionId: string]; result: SessionTokenUsage };
  'tokens:get-daily-usage':             { params: [date?: string, provider?: string]; result: DailyTokenUsage };
  'tokens:get-model-breakdown':         { params: [days?: number, provider?: string]; result: ModelTokenBreakdown[] };
  'tokens:get-heatmap':                 { params: [startDate: string, endDate: string, provider?: string, fillEmptyDays?: boolean]; result: TokenHeatmapEntry[] };
  'tokens:refresh':                     { params: []; result: void };
  'quota:list':                         { params: [forceRefresh?: boolean]; result: QuotaSnapshot[] };

  // --- Input ---
  'input:get-daily-stats':              { params: [date?: string, provider?: string]; result: DailyInputStats };
  'input:get-heatmap':                  { params: [startDate: string, endDate: string, provider?: string, fillEmptyDays?: boolean]; result: InputHeatmapEntry[] };
  'input:get-cadence':                  { params: [date?: string, provider?: string]; result: InputCadenceInfo };

  // --- Prompt History ---
  'prompt-history:search':              { params: [query: string, limit?: number]; result: PromptHistoryEntry[] };
  'prompt-history:recent':              { params: [limit?: number]; result: PromptHistoryEntry[] };
  'prompt-history:delete':              { params: [id: number]; result: void };
  'prompt-history:toggle-pin':          { params: [id: number]; result: void };

  // --- Shell History (read from user's $HISTFILE) ---
  'shell-history:recent':               { params: [limit?: number, query?: string]; result: ShellHistoryEntry[] };

  // --- Commits ---
  'commits:get-daily-stats':            { params: [date?: string, provider?: string]; result: DailyCommitStats };
  'commits:get-heatmap':                { params: [startDate: string, endDate: string, provider?: string, fillEmptyDays?: boolean]; result: CommitHeatmapEntry[] };
  'commits:get-streaks':                { params: [provider?: string]; result: CommitStreakInfo };
  'commits:get-cadence':                { params: [date?: string, provider?: string]; result: CommitCadenceInfo };
  'commits:refresh':                    { params: []; result: void };
  'commits:force-rescan':               { params: []; result: void };
}

export interface TrackersPushContract {
  'commits:updated':                    { params: [] };
  'tokens:updated':                     { params: [] };
}
