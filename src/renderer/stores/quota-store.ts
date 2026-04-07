import { create } from 'zustand';
import type { QuotaSnapshot } from '@shared/types';

interface QuotaState {
  snapshots: QuotaSnapshot[];
  loading: boolean;
  refresh(forceRefresh?: boolean): Promise<void>;
}

export const useQuotaStore = create<QuotaState>((set) => ({
  snapshots: [],
  loading: false,

  refresh: async (forceRefresh?: boolean) => {
    set({ loading: true });
    try {
      const snapshots = await window.mcode.quota.list(forceRefresh);
      set({ snapshots, loading: false });
    } catch {
      set({ loading: false });
    }
  },
}));
