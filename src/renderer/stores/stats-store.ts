import { create } from 'zustand';
import type {
  DailyTokenUsage,
  TokenHeatmapEntry,
  TokenWeeklyTrend,
  DailyCommitStats,
  CommitHeatmapEntry,
  CommitStreakInfo,
  CommitCadenceInfo,
  CommitWeeklyTrend,
  DailyInputStats,
  InputHeatmapEntry,
  InputWeeklyTrend,
  InputCadenceInfo,
} from '@shared/types';

interface StatsState {
  // Token data
  dailyUsage: DailyTokenUsage | null;
  tokenHeatmap: TokenHeatmapEntry[];
  tokenWeeklyTrend: TokenWeeklyTrend | null;
  // Commit data
  dailyStats: DailyCommitStats | null;
  commitHeatmap: CommitHeatmapEntry[];
  streaks: CommitStreakInfo | null;
  cadence: CommitCadenceInfo | null;
  commitWeeklyTrend: CommitWeeklyTrend | null;
  // Input data
  dailyInputStats: DailyInputStats | null;
  inputHeatmap: InputHeatmapEntry[];
  inputWeeklyTrend: InputWeeklyTrend | null;
  inputCadence: InputCadenceInfo | null;
  // Shared
  loading: boolean;
  selectedDate: string | null; // null = today

  refreshAll(): Promise<void>;
  setSelectedDate(date: string | null): Promise<void>;
}

export const useStatsStore = create<StatsState>((set, get) => ({
  dailyUsage: null,
  tokenHeatmap: [],
  tokenWeeklyTrend: null,
  dailyStats: null,
  commitHeatmap: [],
  streaks: null,
  cadence: null,
  commitWeeklyTrend: null,
  dailyInputStats: null,
  inputHeatmap: [],
  inputWeeklyTrend: null,
  inputCadence: null,
  loading: false,
  selectedDate: null,

  refreshAll: async () => {
    const { selectedDate } = get();
    set({ loading: true });
    try {
      const [
        dailyUsage,
        tokenHeatmap,
        tokenWeeklyTrend,
        dailyStats,
        commitHeatmap,
        streaks,
        cadence,
        commitWeeklyTrend,
        dailyInputStats,
        inputHeatmap,
        inputWeeklyTrend,
        inputCadence,
      ] = await Promise.all([
        window.mcode.tokens.getDailyUsage(selectedDate ?? undefined),
        window.mcode.tokens.getHeatmap(90),
        window.mcode.tokens.getWeeklyTrend(),
        window.mcode.commits.getDailyStats(selectedDate ?? undefined),
        window.mcode.commits.getHeatmap(90),
        window.mcode.commits.getStreaks(),
        window.mcode.commits.getCadence(selectedDate ?? undefined),
        window.mcode.commits.getWeeklyTrend(),
        window.mcode.input.getDailyStats(selectedDate ?? undefined),
        window.mcode.input.getHeatmap(90),
        window.mcode.input.getWeeklyTrend(),
        window.mcode.input.getCadence(selectedDate ?? undefined),
      ]);
      set({
        dailyUsage,
        tokenHeatmap,
        tokenWeeklyTrend,
        dailyStats,
        commitHeatmap,
        streaks,
        cadence,
        commitWeeklyTrend,
        dailyInputStats,
        inputHeatmap,
        inputWeeklyTrend,
        inputCadence,
        loading: false,
      });
    } catch (err) {
      console.error('Failed to refresh stats:', err);
      set({ loading: false });
    }
  },

  setSelectedDate: (date) => {
    set({ selectedDate: date });
    return get().refreshAll();
  },
}));
