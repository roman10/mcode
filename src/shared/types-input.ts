// --- Human Input Tracking ---

import type { AgentSessionType } from './session-agents';

export interface ProviderInputSummary {
  provider: AgentSessionType;
  messageCount: number;
  totalCharacters: number;
}

export interface DailyInputStats {
  date: string;
  messageCount: number;
  totalCharacters: number;
  totalWords: number;
  activeSessionCount: number;
  messagesPerCommit: number | null;
  byProvider: ProviderInputSummary[];
}

export interface InputHeatmapEntry {
  date: string;
  messageCount: number;
  totalCharacters: number;
}

export interface InputWeeklyTrend {
  thisWeek: { messageCount: number; totalCharacters: number };
  lastWeek: { messageCount: number; totalCharacters: number };
  pctChange: number | null;
}

export interface InputCadenceInfo {
  avgThinkTimeMinutes: number | null;
  peakHour: string | null;
  leverageRatio: number | null;
}
