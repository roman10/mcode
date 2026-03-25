// --- Human Input Tracking ---

export interface DailyInputStats {
  date: string;
  messageCount: number;
  totalCharacters: number;
  totalWords: number;
  activeSessionCount: number;
  messagesPerCommit: number | null;
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
