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
import type { AgentSessionType } from '@shared/session-agents';
import { todayStr, shiftDate } from '../utils/date-nav';

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
  providerFilter: AgentSessionType | null; // null = all providers

  refreshAll(): Promise<void>;
  setSelectedDate(date: string | null): Promise<void>;
  setProviderFilter(provider: AgentSessionType | null): Promise<void>;
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
  providerFilter: null,

  refreshAll: async () => {
    const { selectedDate, providerFilter } = get();
    const provider = providerFilter ?? undefined;
    const endStr = todayStr();
    const startStr = shiftDate(endStr, -89);
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
        window.mcode.tokens.getDailyUsage(selectedDate ?? undefined, provider),
        window.mcode.tokens.getHeatmap(startStr, endStr, provider),
        window.mcode.tokens.getWeeklyTrend(provider),
        window.mcode.commits.getDailyStats(selectedDate ?? undefined, provider),
        window.mcode.commits.getHeatmap(startStr, endStr, provider),
        window.mcode.commits.getStreaks(provider),
        window.mcode.commits.getCadence(selectedDate ?? undefined, provider),
        window.mcode.commits.getWeeklyTrend(provider),
        window.mcode.input.getDailyStats(selectedDate ?? undefined, provider),
        window.mcode.input.getHeatmap(startStr, endStr, provider),
        window.mcode.input.getWeeklyTrend(provider),
        window.mcode.input.getCadence(selectedDate ?? undefined, provider),
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

  setProviderFilter: async (provider) => {
    set({ providerFilter: provider });
    // Persist preference
    window.mcode.preferences.set('statsProviderFilter', provider ?? '').catch(() => {});
    return get().refreshAll();
  },
}));
