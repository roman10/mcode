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
  SessionTokenUsage,
  TokenHeatmapEntry,
  TokenWeeklyTrend,
} from './types';

// ---------------------------------------------------------------------------
// Tokens, Commits, and Input tracker IPC channels
// ---------------------------------------------------------------------------

export interface TrackersInvokeContract {
  // --- Tokens ---
  'tokens:get-session-usage':           { params: [claudeSessionId: string]; result: SessionTokenUsage };
  'tokens:get-daily-usage':             { params: [date?: string]; result: DailyTokenUsage };
  'tokens:get-model-breakdown':         { params: [days?: number]; result: ModelTokenBreakdown[] };
  'tokens:get-weekly-trend':            { params: []; result: TokenWeeklyTrend };
  'tokens:get-heatmap':                 { params: [days?: number]; result: TokenHeatmapEntry[] };
  'tokens:refresh':                     { params: []; result: void };

  // --- Input ---
  'input:get-daily-stats':              { params: [date?: string]; result: DailyInputStats };
  'input:get-heatmap':                  { params: [days?: number]; result: InputHeatmapEntry[] };
  'input:get-weekly-trend':             { params: []; result: InputWeeklyTrend };
  'input:get-cadence':                  { params: [date?: string]; result: InputCadenceInfo };

  // --- Commits ---
  'commits:get-daily-stats':            { params: [date?: string]; result: DailyCommitStats };
  'commits:get-heatmap':                { params: [days?: number]; result: CommitHeatmapEntry[] };
  'commits:get-streaks':                { params: []; result: CommitStreakInfo };
  'commits:get-cadence':                { params: [date?: string]; result: CommitCadenceInfo };
  'commits:get-weekly-trend':           { params: []; result: CommitWeeklyTrend };
  'commits:refresh':                    { params: []; result: void };
  'commits:force-rescan':               { params: []; result: void };
}

export interface TrackersPushContract {
  'commits:updated':                    { params: [] };
  'tokens:updated':                     { params: [] };
}
