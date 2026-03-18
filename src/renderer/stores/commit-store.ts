import { create } from 'zustand';
import type {
  DailyCommitStats,
  CommitHeatmapEntry,
  CommitStreakInfo,
  CommitCadenceInfo,
  CommitWeeklyTrend,
} from '../../shared/types';

interface CommitState {
  dailyStats: DailyCommitStats | null;
  heatmap: CommitHeatmapEntry[];
  streaks: CommitStreakInfo | null;
  cadence: CommitCadenceInfo | null;
  weeklyTrend: CommitWeeklyTrend | null;
  loading: boolean;

  refreshAll(): Promise<void>;
}

export const useCommitStore = create<CommitState>((set) => ({
  dailyStats: null,
  heatmap: [],
  streaks: null,
  cadence: null,
  weeklyTrend: null,
  loading: false,

  refreshAll: async () => {
    set({ loading: true });
    try {
      const [dailyStats, heatmap, streaks, cadence, weeklyTrend] = await Promise.all([
        window.mcode.commits.getDailyStats(),
        window.mcode.commits.getHeatmap(7),
        window.mcode.commits.getStreaks(),
        window.mcode.commits.getCadence(),
        window.mcode.commits.getWeeklyTrend(),
      ]);
      set({ dailyStats, heatmap, streaks, cadence, weeklyTrend, loading: false });
    } catch (err) {
      console.error('Failed to refresh commit stats:', err);
      set({ loading: false });
    }
  },
}));
