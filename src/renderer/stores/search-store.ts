import { create } from 'zustand';
import type { FileSearchMatch, SearchEvent } from '@shared/types';
import { useSessionStore } from './session-store';

export interface RepoResults {
  repoName: string;
  files: Map<string, FileSearchMatch[]>; // filePath → matches
  matchCount: number;
}

interface SearchState {
  // Query inputs
  query: string;
  isRegex: boolean;
  caseSensitive: boolean;

  // Search state
  searchId: string | null;
  searching: boolean;

  // Results
  results: Map<string, RepoResults>; // repoPath → RepoResults
  totalMatches: number;
  totalFiles: number;
  truncated: boolean;
  durationMs: number | null;
  error: string | null;

  // UI state
  expandedRepos: Set<string>;
  expandedFiles: Set<string>; // "repoPath\0filePath" compound key

  // Actions
  setQuery(query: string): void;
  toggleRegex(): void;
  toggleCaseSensitive(): void;
  startSearch(): void;
  cancelSearch(): void;
  handleEvent(event: SearchEvent): void;
  toggleRepo(repoPath: string): void;
  toggleFile(repoPath: string, filePath: string): void;
  clear(): void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let searchCounter = 0;

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  isRegex: false,
  caseSensitive: false,
  searchId: null,
  searching: false,
  results: new Map(),
  totalMatches: 0,
  totalFiles: 0,
  truncated: false,
  durationMs: null,
  error: null,
  expandedRepos: new Set(),
  expandedFiles: new Set(),

  setQuery: (query: string) => {
    set({ query });
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!query.trim()) {
      // Clear results immediately on empty query
      get().cancelSearch();
      set({
        results: new Map(),
        totalMatches: 0,
        totalFiles: 0,
        truncated: false,
        durationMs: null,
        error: null,
        searching: false,
      });
      return;
    }
    debounceTimer = setTimeout(() => {
      get().startSearch();
    }, 300);
  },

  toggleRegex: () => {
    set((s) => ({ isRegex: !s.isRegex }));
    if (get().query.trim()) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => get().startSearch(), 300);
    }
  },

  toggleCaseSensitive: () => {
    set((s) => ({ caseSensitive: !s.caseSensitive }));
    if (get().query.trim()) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => get().startSearch(), 300);
    }
  },

  startSearch: () => {
    const { query, isRegex, caseSensitive, searchId: prevId } = get();
    if (!query.trim()) return;

    // Cancel previous search
    if (prevId) {
      window.mcode.search.cancel(prevId).catch(() => {});
    }

    // Collect unique cwds from all sessions
    const sessions = useSessionStore.getState().sessions;
    const cwds = [...new Set(Object.values(sessions).map((s) => s.cwd))];
    if (cwds.length === 0) {
      set({ error: 'No sessions open', searching: false });
      return;
    }

    const id = `search-${++searchCounter}`;
    set({
      searchId: id,
      searching: true,
      results: new Map(),
      totalMatches: 0,
      totalFiles: 0,
      truncated: false,
      durationMs: null,
      error: null,
      expandedRepos: new Set(),
      expandedFiles: new Set(),
    });

    window.mcode.search.start({ id, query, isRegex, caseSensitive, cwds }).catch((err) => {
      set({ error: String(err), searching: false });
    });
  },

  cancelSearch: () => {
    const { searchId } = get();
    if (searchId) {
      window.mcode.search.cancel(searchId).catch(() => {});
      set({ searchId: null, searching: false });
    }
  },

  handleEvent: (event: SearchEvent) => {
    const { searchId } = get();
    // Ignore events from stale searches
    if (event.searchId !== searchId) return;

    if (event.type === 'progress') {
      set((state) => {
        const results = new Map(state.results);
        const existing = results.get(event.repoPath);
        if (existing) {
          // Create new files Map to avoid mutating previous state
          const newFiles = new Map(existing.files);
          for (const match of event.matches) {
            const prev = newFiles.get(match.path);
            newFiles.set(match.path, prev ? [...prev, match] : [match]);
          }
          results.set(event.repoPath, {
            repoName: existing.repoName,
            files: newFiles,
            matchCount: existing.matchCount + event.matches.length,
          });
        } else {
          // New repo
          const files = new Map<string, FileSearchMatch[]>();
          for (const match of event.matches) {
            const prev = files.get(match.path);
            files.set(match.path, prev ? [...prev, match] : [match]);
          }
          results.set(event.repoPath, {
            repoName: event.repoName,
            files,
            matchCount: event.matches.length,
          });
        }

        // Auto-expand repos as results come in
        const expandedRepos = new Set(state.expandedRepos);
        expandedRepos.add(event.repoPath);

        return {
          results,
          totalMatches: state.totalMatches + event.matches.length,
          expandedRepos,
        };
      });
    } else if (event.type === 'complete') {
      set({
        searching: false,
        totalMatches: event.totalMatches,
        totalFiles: event.totalFiles,
        truncated: event.truncated,
        durationMs: event.durationMs,
      });
    } else if (event.type === 'error') {
      set({ error: event.message, searching: false });
    }
  },

  toggleRepo: (repoPath: string) => {
    set((state) => {
      const expanded = new Set(state.expandedRepos);
      if (expanded.has(repoPath)) expanded.delete(repoPath);
      else expanded.add(repoPath);
      return { expandedRepos: expanded };
    });
  },

  toggleFile: (repoPath: string, filePath: string) => {
    const key = `${repoPath}\0${filePath}`;
    set((state) => {
      const expanded = new Set(state.expandedFiles);
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      return { expandedFiles: expanded };
    });
  },

  clear: () => {
    get().cancelSearch();
    set({
      query: '',
      results: new Map(),
      totalMatches: 0,
      totalFiles: 0,
      truncated: false,
      durationMs: null,
      error: null,
      searching: false,
      expandedRepos: new Set(),
      expandedFiles: new Set(),
    });
  },
}));
