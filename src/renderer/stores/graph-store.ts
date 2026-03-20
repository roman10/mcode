import { create } from 'zustand';
import type { CommitGraphNode } from '../../shared/types';

interface GraphState {
  /** Graph data keyed by repo root path. */
  graphs: Record<string, { commits: CommitGraphNode[]; hasMore: boolean }>;
  loading: boolean;
  expanded: boolean;

  setExpanded(expanded: boolean): void;
  fetchGraph(repoPath: string, limit?: number): Promise<void>;
  fetchMore(repoPath: string): Promise<void>;
  refreshAll(repoRoots: string[]): Promise<void>;
}

const DEFAULT_LIMIT = 30;

export const useGraphStore = create<GraphState>((set, get) => ({
  graphs: {},
  loading: false,
  expanded: false,

  setExpanded: (expanded) => set({ expanded }),

  fetchGraph: async (repoPath, limit = DEFAULT_LIMIT) => {
    set({ loading: true });
    try {
      const result = await window.mcode.git.getGraphLog(repoPath, limit, 0);
      set((state) => ({
        graphs: {
          ...state.graphs,
          [repoPath]: { commits: result.commits, hasMore: result.hasMore },
        },
        loading: false,
      }));
    } catch (err) {
      console.error('Failed to fetch graph:', err);
      set({ loading: false });
    }
  },

  fetchMore: async (repoPath) => {
    const current = get().graphs[repoPath];
    if (!current?.hasMore) return;

    try {
      const result = await window.mcode.git.getGraphLog(repoPath, DEFAULT_LIMIT, current.commits.length);
      set((state) => ({
        graphs: {
          ...state.graphs,
          [repoPath]: {
            commits: [...(state.graphs[repoPath]?.commits ?? []), ...result.commits],
            hasMore: result.hasMore,
          },
        },
      }));
    } catch (err) {
      console.error('Failed to fetch more commits:', err);
    }
  },

  refreshAll: async (repoRoots) => {
    set({ loading: true });
    try {
      const results = await Promise.all(
        repoRoots.map((repoPath) => window.mcode.git.getGraphLog(repoPath, DEFAULT_LIMIT, 0)),
      );

      const graphs: Record<string, { commits: CommitGraphNode[]; hasMore: boolean }> = {};
      for (const result of results) {
        if (result.commits.length > 0) {
          graphs[result.repoRoot] = { commits: result.commits, hasMore: result.hasMore };
        }
      }

      set({ graphs, loading: false });
    } catch (err) {
      console.error('Failed to refresh graphs:', err);
      set({ loading: false });
    }
  },
}));
