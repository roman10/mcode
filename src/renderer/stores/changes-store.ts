import { create } from 'zustand';
import type { GitStatusResult } from '../../shared/types';

interface ChangesState {
  statuses: GitStatusResult[];
  loading: boolean;

  refreshAll(): Promise<void>;
}

export const useChangesStore = create<ChangesState>((set) => ({
  statuses: [],
  loading: false,

  refreshAll: async () => {
    set({ loading: true });
    try {
      const statuses = await window.mcode.git.getAllStatuses();
      set({ statuses, loading: false });
    } catch (err) {
      console.error('Failed to refresh git statuses:', err);
      set({ loading: false });
    }
  },
}));
