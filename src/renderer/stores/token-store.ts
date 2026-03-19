import { create } from 'zustand';
import type {
  DailyTokenUsage,
  TokenHeatmapEntry,
  ModelTokenBreakdown,
  TokenWeeklyTrend,
} from '../../shared/types';

interface TokenState {
  dailyUsage: DailyTokenUsage | null;
  heatmap: TokenHeatmapEntry[];
  modelBreakdown: ModelTokenBreakdown[];
  weeklyTrend: TokenWeeklyTrend | null;
  loading: boolean;

  refreshAll(): Promise<void>;
}

export const useTokenStore = create<TokenState>((set) => ({
  dailyUsage: null,
  heatmap: [],
  modelBreakdown: [],
  weeklyTrend: null,
  loading: false,

  refreshAll: async () => {
    set({ loading: true });
    try {
      const [dailyUsage, heatmap, modelBreakdown, weeklyTrend] = await Promise.all([
        window.mcode.tokens.getDailyUsage(),
        window.mcode.tokens.getHeatmap(7),
        window.mcode.tokens.getModelBreakdown(30),
        window.mcode.tokens.getWeeklyTrend(),
      ]);
      set({ dailyUsage, heatmap, modelBreakdown, weeklyTrend, loading: false });
    } catch (err) {
      console.error('Failed to refresh token stats:', err);
      set({ loading: false });
    }
  },
}));
