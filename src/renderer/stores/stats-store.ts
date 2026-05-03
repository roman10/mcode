import { create } from 'zustand';
import type {
  DailyTokenUsage,
  TokenHeatmapEntry,
  DailyCommitStats,
  CommitHeatmapEntry,
  CommitStreakInfo,
  CommitCadenceInfo,
  DailyInputStats,
  InputHeatmapEntry,
  InputCadenceInfo,
} from '@shared/types';
import type { AgentSessionType } from '@shared/session-agents';
import { todayStr, shiftDate } from '../utils/date-nav';

interface StatsState {
  // Token data
  dailyUsage: DailyTokenUsage | null;
  tokenHeatmap: TokenHeatmapEntry[];
  // Commit data
  dailyStats: DailyCommitStats | null;
  commitHeatmap: CommitHeatmapEntry[];
  streaks: CommitStreakInfo | null;
  cadence: CommitCadenceInfo | null;
  // Input data
  dailyInputStats: DailyInputStats | null;
  inputHeatmap: InputHeatmapEntry[];
  inputCadence: InputCadenceInfo | null;
  // Shared
  loading: boolean;
  selectedDate: string | null; // null = today
  providerFilter: AgentSessionType | null; // null = all providers

  refreshAll(): Promise<void>;
  refreshDaily(): Promise<void>;
  refreshRange(): Promise<void>;
  setSelectedDate(date: string | null): Promise<void>;
  setProviderFilter(provider: AgentSessionType | null): Promise<void>;
}

export const useStatsStore = create<StatsState>((set, get) => {
  // Per-stream epoch counters guard against rapid successive refreshes resolving
  // out of order — a stale response can otherwise stomp newer state.
  let dailyEpoch = 0;
  let rangeEpoch = 0;

  return {
    dailyUsage: null,
    tokenHeatmap: [],
    dailyStats: null,
    commitHeatmap: [],
    streaks: null,
    cadence: null,
    dailyInputStats: null,
    inputHeatmap: [],
    inputCadence: null,
    loading: false,
    selectedDate: null,
    providerFilter: null,

    refreshDaily: async () => {
      const { selectedDate, providerFilter } = get();
      const provider = providerFilter ?? undefined;
      const my = ++dailyEpoch;
      try {
        const [dailyUsage, dailyStats, cadence, dailyInputStats, inputCadence] = await Promise.all([
          window.mcode.tokens.getDailyUsage(selectedDate ?? undefined, provider),
          window.mcode.commits.getDailyStats(selectedDate ?? undefined, provider),
          window.mcode.commits.getCadence(selectedDate ?? undefined, provider),
          window.mcode.input.getDailyStats(selectedDate ?? undefined, provider),
          window.mcode.input.getCadence(selectedDate ?? undefined, provider),
        ]);
        if (my !== dailyEpoch) return;
        set({ dailyUsage, dailyStats, cadence, dailyInputStats, inputCadence });
      } catch (err) {
        console.error('Failed to refresh daily stats:', err);
      }
    },

    refreshRange: async () => {
      const { providerFilter } = get();
      const provider = providerFilter ?? undefined;
      const endStr = todayStr();
      const startStr = shiftDate(endStr, -89);
      const my = ++rangeEpoch;
      try {
        const [tokenHeatmap, commitHeatmap, streaks, inputHeatmap] = await Promise.all([
          window.mcode.tokens.getHeatmap(startStr, endStr, provider),
          window.mcode.commits.getHeatmap(startStr, endStr, provider),
          window.mcode.commits.getStreaks(provider),
          window.mcode.input.getHeatmap(startStr, endStr, provider),
        ]);
        if (my !== rangeEpoch) return;
        set({ tokenHeatmap, commitHeatmap, streaks, inputHeatmap });
      } catch (err) {
        console.error('Failed to refresh range stats:', err);
      }
    },

    refreshAll: async () => {
      const isFirstLoad = get().dailyUsage == null && get().dailyStats == null;
      if (isFirstLoad) set({ loading: true });
      try {
        await Promise.all([get().refreshDaily(), get().refreshRange()]);
      } finally {
        if (get().loading) set({ loading: false });
      }
    },

    setSelectedDate: (date) => {
      set({ selectedDate: date });
      return get().refreshDaily();
    },

    setProviderFilter: async (provider) => {
      set({ providerFilter: provider });
      // Persist preference
      window.mcode.preferences.set('statsProviderFilter', provider ?? '').catch(() => {});
      return get().refreshAll();
    },
  };
});
