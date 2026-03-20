import { create } from 'zustand';
import type {
  DailyTokenUsage,
  TokenHeatmapEntry,
  TokenWeeklyTrend,
} from '../../shared/types';

interface TokenState {
  dailyUsage: DailyTokenUsage | null;
  heatmap: TokenHeatmapEntry[];
  weeklyTrend: TokenWeeklyTrend | null;
  loading: boolean;
  selectedDate: string | null; // null = today

  refreshAll(): Promise<void>;
  setSelectedDate(date: string | null): void;
}

export const useTokenStore = create<TokenState>((set, get) => ({
  dailyUsage: null,
  heatmap: [],
  weeklyTrend: null,
  loading: false,
  selectedDate: null,

  refreshAll: async () => {
    const { selectedDate } = get();
    set({ loading: true });
    try {
      const [dailyUsage, heatmap, weeklyTrend] = await Promise.all([
        window.mcode.tokens.getDailyUsage(selectedDate ?? undefined),
        window.mcode.tokens.getHeatmap(90),
        window.mcode.tokens.getWeeklyTrend(),
      ]);
      set({ dailyUsage, heatmap, weeklyTrend, loading: false });
    } catch (err) {
      console.error('Failed to refresh token stats:', err);
      set({ loading: false });
    }
  },

  setSelectedDate: (date) => {
    set({ selectedDate: date });
    get().refreshAll();
  },
}));
