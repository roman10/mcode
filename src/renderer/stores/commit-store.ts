import { create } from 'zustand';
import type {
  DailyCommitStats,
  CommitHeatmapEntry,
  CommitStreakInfo,
  CommitCadenceInfo,
  CommitWeeklyTrend,
} from '@shared/types';

interface CommitState {
  dailyStats: DailyCommitStats | null;
  heatmap: CommitHeatmapEntry[];
  streaks: CommitStreakInfo | null;
  cadence: CommitCadenceInfo | null;
  weeklyTrend: CommitWeeklyTrend | null;
  loading: boolean;
  selectedDate: string | null; // null = today

  refreshAll(): Promise<void>;
  setSelectedDate(date: string | null): void;
}

export const useCommitStore = create<CommitState>((set, get) => ({
  dailyStats: null,
  heatmap: [],
  streaks: null,
  cadence: null,
  weeklyTrend: null,
  loading: false,
  selectedDate: null,

  refreshAll: async () => {
    const { selectedDate } = get();
    set({ loading: true });
    try {
      const [dailyStats, heatmap, streaks, cadence, weeklyTrend] = await Promise.all([
        window.mcode.commits.getDailyStats(selectedDate ?? undefined),
        window.mcode.commits.getHeatmap(90),
        window.mcode.commits.getStreaks(),
        window.mcode.commits.getCadence(selectedDate ?? undefined),
        window.mcode.commits.getWeeklyTrend(),
      ]);
      set({ dailyStats, heatmap, streaks, cadence, weeklyTrend, loading: false });
    } catch (err) {
      console.error('Failed to refresh commit stats:', err);
      set({ loading: false });
    }
  },

  setSelectedDate: (date) => {
    set({ selectedDate: date });
    get().refreshAll();
  },
}));
