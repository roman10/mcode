// --- Commit Tracking ---

interface RepoCommitStats {
  repoPath: string;
  count: number;
  insertions: number;
  deletions: number;
}

interface CommitTypeStats {
  type: string;
  count: number;
}

export interface DailyCommitStats {
  date: string;
  total: number;
  totalInsertions: number;
  totalDeletions: number;
  claudeAssisted: number;
  soloCount: number;
  byRepo: RepoCommitStats[];
  byType: CommitTypeStats[];
}

export interface CommitHeatmapEntry {
  date: string;
  count: number;
  insertions: number;
}

export interface CommitStreakInfo {
  current: number;
  longest: number;
}

export interface CommitCadenceInfo {
  avgMinutes: number | null;
  peakHour: string | null;
  commitsByHour: Record<string, number>;
}

export interface CommitWeeklyTrend {
  thisWeek: number;
  lastWeek: number;
  pctChange: number | null;
}
