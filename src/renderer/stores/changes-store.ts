import { create } from 'zustand';
import type { GitStatusResult } from '../../shared/types';

interface ChangesState {
  statuses: GitStatusResult[];
  loading: boolean;

  refreshAll(): Promise<void>;
  stageFile(repoRoot: string, filePath: string): Promise<void>;
  unstageFile(repoRoot: string, filePath: string): Promise<void>;
  discardFile(repoRoot: string, filePath: string, isUntracked: boolean): Promise<void>;
  stageAll(repoRoot: string): Promise<void>;
  unstageAll(repoRoot: string): Promise<void>;
  discardAll(repoRoot: string): Promise<void>;
}

export const useChangesStore = create<ChangesState>((set, get) => ({
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

  stageFile: async (repoRoot, filePath) => {
    await window.mcode.git.stageFile(repoRoot, filePath);
    await get().refreshAll();
  },

  unstageFile: async (repoRoot, filePath) => {
    await window.mcode.git.unstageFile(repoRoot, filePath);
    await get().refreshAll();
  },

  discardFile: async (repoRoot, filePath, isUntracked) => {
    await window.mcode.git.discardFile(repoRoot, filePath, isUntracked);
    await get().refreshAll();
  },

  stageAll: async (repoRoot) => {
    await window.mcode.git.stageAll(repoRoot);
    await get().refreshAll();
  },

  unstageAll: async (repoRoot) => {
    await window.mcode.git.unstageAll(repoRoot);
    await get().refreshAll();
  },

  discardAll: async (repoRoot) => {
    await window.mcode.git.discardAll(repoRoot);
    await get().refreshAll();
  },
}));

// Auto-refresh when main process detects git status changes from hook events
if (typeof window !== 'undefined' && window.mcode?.git?.onStatusChanged) {
  window.mcode.git.onStatusChanged(() => {
    useChangesStore.getState().refreshAll();
  });
}
