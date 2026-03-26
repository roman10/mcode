import { create } from 'zustand';
import type { MosaicNode } from 'react-mosaic-component';
import {
  createBalancedTreeFromLeaves,
  getLeaves,
} from 'react-mosaic-component';
import { LAYOUT_PERSIST_DEBOUNCE_MS } from '@shared/constants';
import type { SidebarTab, ViewMode } from '@shared/types';
import {
  FILE_TILE_PREFIX,
  DIFF_TILE_PREFIX,
  COMMIT_DIFF_TILE_PREFIX,
  sessionIdFromTileId,
} from '../utils/tile-id';

/** Legacy tile IDs — stripped from persisted layouts on restore. */
const LEGACY_TILE_IDS = ['dashboard', 'commit-stats', 'token-stats'];

/** Migrate persisted sidebar tab values from previous schema to the current schema. Exported for testing. */
export function migrateTab(tab: string): SidebarTab {
  if (tab === 'commits' || tab === 'tokens') return 'stats';
  const valid: SidebarTab[] = ['sessions', 'search', 'changes', 'stats', 'activity'];
  return valid.includes(tab as SidebarTab) ? (tab as SidebarTab) : 'sessions';
}

/** Snapshot the terminal panel store for persistence (avoids circular import). */
function getTerminalPanelSnapshot(): unknown {
  const { useTerminalPanelStore } = require('./terminal-panel-store') as {
    useTerminalPanelStore: { getState: () => Record<string, unknown> };
  };
  const state = useTerminalPanelStore.getState();
  return {
    panelHeight: state.panelHeight,
    panelVisible: state.panelVisible,
    tabGroups: state.tabGroups,
    splitTree: state.splitTree,
    activeTabGroupId: state.activeTabGroupId,
    terminals: state.terminals,
  };
}

function fileTileId(absolutePath: string): string {
  return `${FILE_TILE_PREFIX}${absolutePath}`;
}

function diffTileId(absolutePath: string): string {
  return `${DIFF_TILE_PREFIX}${absolutePath}`;
}

function commitDiffTileId(absolutePath: string, commitHash: string): string {
  return `${COMMIT_DIFF_TILE_PREFIX}${commitHash}:${absolutePath}`;
}

interface SplitIntent {
  anchorSessionId: string;
  direction: 'row' | 'column';
}

interface LayoutState {
  mosaicTree: MosaicNode<string> | null;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  activeSidebarTab: SidebarTab;
  showActivityTab: boolean;
  viewMode: ViewMode;
  kanbanExpandedSessionId: string | null; // transient, not persisted
  kanbanOpenFiles: string[]; // transient, not persisted
  kanbanActiveFile: string | null; // transient, not persisted
  kanbanSplitRatio: number; // transient, 0-1, default 0.5
  sessionFilterQuery: string; // transient, not persisted
  splitIntent: SplitIntent | null;
  showNewSessionDialog: boolean;
  showKeyboardShortcuts: boolean;
  showSettings: boolean;
  showAccountsDialog: boolean;
  showCommandPalette: boolean;
  showCreateTaskDialog: boolean;
  quickOpenInitialMode: 'files' | 'commands' | 'shell' | 'snippets';
  restoreTree: MosaicNode<string> | null;
  pendingFileLine: { path: string; line: number } | null;
  /** Tracks the focused tile ID (for non-session tiles like file/diff viewers). Transient, not persisted. */
  selectedTileId: string | null;

  setMosaicTree(tree: MosaicNode<string> | null): void;
  setSelectedTileId(id: string | null): void;
  addTile(sessionId: string): void;
  addTileAdjacent(anchorSessionId: string, newSessionId: string, direction: 'row' | 'column'): void;
  removeTile(sessionId: string): void;
  removeAllTiles(): void;
  replaceTile(oldSessionId: string, newSessionId: string): void;
  setSidebarWidth(width: number): void;
  toggleSidebar(): void;
  setActiveSidebarTab(tab: SidebarTab): void;
  setShowActivityTab(show: boolean): void;
  setViewMode(mode: ViewMode): void;
  expandKanbanSession(sessionId: string): void;
  clearKanbanExpand(): void;
  openKanbanFile(absolutePath: string): void;
  closeKanbanFile(absolutePath: string): void;
  setKanbanActiveFile(absolutePath: string): void;
  clearKanbanFiles(): void;
  setKanbanSplitRatio(ratio: number): void;
  setSessionFilterQuery(query: string): void;
  setSplitIntent(intent: SplitIntent | null): void;
  setShowNewSessionDialog(show: boolean): void;
  setShowKeyboardShortcuts(show: boolean): void;
  setShowSettings(show: boolean): void;
  setShowAccountsDialog(show: boolean): void;
  setShowCommandPalette(show: boolean): void;
  setShowCreateTaskDialog(show: boolean): void;
  openQuickOpen(mode: 'files' | 'commands' | 'shell' | 'snippets'): void;
  addFileViewer(absolutePath: string, options?: { line?: number }): void;
  consumePendingFileLine(path: string): number | null;
  removeFileTile(absolutePath: string): void;
  stripFileTiles(): void;
  addDiffViewer(absolutePath: string, commitHash?: string): void;
  removeDiffTile(absolutePath: string): void;
  maximize(sessionId: string): void;
  restoreFromMaximize(): void;
  removeAnyTile(tileId: string): void;
  persist(): void;
  flushPersist(): void;
  restore(): Promise<void>;
  pruneTiles(liveSessionIds: Set<string>): void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function tileId(sessionId: string): string {
  return `session:${sessionId}`;
}

/** Swap one leaf for another in the mosaic tree, preserving layout structure. */
function replaceLeaf(
  node: MosaicNode<string>,
  oldLeaf: string,
  newLeaf: string,
): MosaicNode<string> {
  if (typeof node === 'string') {
    return node === oldLeaf ? newLeaf : node;
  }
  if (node.type === 'split') {
    return { ...node, children: node.children.map((c) => replaceLeaf(c, oldLeaf, newLeaf)) };
  }
  if (node.type === 'tabs') {
    return { ...node, tabs: node.tabs.map((t) => (t === oldLeaf ? newLeaf : t)) };
  }
  return node;
}

/** Replace a leaf with a split node containing the original and a new leaf. */
function insertAdjacentLeaf(
  node: MosaicNode<string>,
  anchorLeaf: string,
  newLeaf: string,
  direction: 'row' | 'column',
): MosaicNode<string> {
  if (typeof node === 'string') {
    if (node === anchorLeaf) {
      return { type: 'split', direction, children: [node, newLeaf] };
    }
    return node;
  }
  if (node.type === 'split') {
    return {
      ...node,
      children: node.children.map((c) => insertAdjacentLeaf(c, anchorLeaf, newLeaf, direction)),
    };
  }
  // Don't split inside tab groups
  return node;
}

/** Remove a specific leaf from the tree, preserving the structure of unaffected splits. */
function removeLeaf(
  node: MosaicNode<string>,
  target: string,
): MosaicNode<string> | null {
  if (typeof node === 'string') {
    return node === target ? null : node;
  }

  if (node.type === 'split') {
    const newChildren: MosaicNode<string>[] = [];
    const newPercentages: number[] = [];
    let removedPct = 0;

    for (let i = 0; i < node.children.length; i++) {
      const result = removeLeaf(node.children[i], target);
      const pct = node.splitPercentages?.[i] ?? 100 / node.children.length;
      if (result !== null) {
        newChildren.push(result);
        newPercentages.push(pct);
      } else {
        removedPct += pct;
      }
    }

    if (newChildren.length === 0) return null;
    if (newChildren.length === 1) return newChildren[0];

    // Redistribute the removed child's percentage equally across remaining siblings
    const redistPerChild = removedPct / newChildren.length;
    return {
      ...node,
      children: newChildren,
      splitPercentages: newPercentages.map((p) => p + redistPerChild),
    };
  }

  return node; // tabs or other node types: unchanged
}

/** Remove nodes referencing dead sessions from the mosaic tree, preserving layout structure. */
function pruneTree(
  node: MosaicNode<string>,
  liveIds: Set<string>,
): MosaicNode<string> | null {
  if (typeof node === 'string') {
    const sid = sessionIdFromTileId(node);
    if (sid && !liveIds.has(sid)) return null;
    return node;
  }

  if (node.type === 'split') {
    const newChildren: MosaicNode<string>[] = [];
    const newPercentages: number[] = [];
    let removedPct = 0;

    for (let i = 0; i < node.children.length; i++) {
      const result = pruneTree(node.children[i], liveIds);
      const pct = node.splitPercentages?.[i] ?? 100 / node.children.length;
      if (result !== null) {
        newChildren.push(result);
        newPercentages.push(pct);
      } else {
        removedPct += pct;
      }
    }

    if (newChildren.length === 0) return null;
    if (newChildren.length === 1) return newChildren[0];

    const redistPerChild = removedPct / newChildren.length;
    return {
      ...node,
      children: newChildren,
      splitPercentages: newPercentages.map((p) => p + redistPerChild),
    };
  }

  return node;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  mosaicTree: null,
  sidebarWidth: 280,
  sidebarCollapsed: false,
  activeSidebarTab: 'sessions' as SidebarTab,
  showActivityTab: false,
  viewMode: 'tiles' as ViewMode,
  kanbanExpandedSessionId: null,
  kanbanOpenFiles: [],
  kanbanActiveFile: null,
  kanbanSplitRatio: 0.5,
  sessionFilterQuery: '',
  splitIntent: null,
  showNewSessionDialog: false,
  showKeyboardShortcuts: false,
  showSettings: false,
  showAccountsDialog: false,
  showCommandPalette: false,
  showCreateTaskDialog: false,
  quickOpenInitialMode: 'files' as const,
  restoreTree: null,
  pendingFileLine: null,
  selectedTileId: null,

  setMosaicTree: (tree) => set({ mosaicTree: tree }),
  setSelectedTileId: (id) => set({ selectedTileId: id }),

  addTile: (sessionId) =>
    set((state) => {
      const newTile = tileId(sessionId);
      const current = state.mosaicTree;

      if (!current) {
        return { mosaicTree: newTile };
      }

      // Check if tile already exists
      const leaves = getLeaves(current);
      if (leaves.includes(newTile)) {
        return state; // Already present
      }

      // Create a balanced tree with all existing leaves plus the new one
      const allLeaves = [...leaves, newTile];
      const newMosaicTree = createBalancedTreeFromLeaves(allLeaves) ?? newTile;

      // If maximized, also add to restoreTree so the tile appears when restoring
      if (state.restoreTree) {
        const restoreLeaves = getLeaves(state.restoreTree);
        if (!restoreLeaves.includes(newTile)) {
          const newRestoreTree =
            createBalancedTreeFromLeaves([...restoreLeaves, newTile]) ?? state.restoreTree;
          return { mosaicTree: newMosaicTree, restoreTree: newRestoreTree };
        }
      }

      return { mosaicTree: newMosaicTree };
    }),

  addTileAdjacent: (anchorSessionId, newSessionId, direction) =>
    set((state) => {
      const anchorTile = tileId(anchorSessionId);
      const newTile = tileId(newSessionId);
      const current = state.mosaicTree;

      if (!current) {
        return { mosaicTree: newTile };
      }

      // Check if new tile already exists
      const leaves = getLeaves(current);
      if (leaves.includes(newTile)) {
        return state;
      }

      // Check if anchor exists in tree
      let newMosaicTree;
      if (!leaves.includes(anchorTile)) {
        // Anchor not found — fall back to balanced insert
        newMosaicTree = createBalancedTreeFromLeaves([...leaves, newTile]) ?? newTile;
      } else {
        newMosaicTree = insertAdjacentLeaf(current, anchorTile, newTile, direction);
      }

      // If maximized, also add to restoreTree so the tile appears when restoring
      if (state.restoreTree) {
        const restoreLeaves = getLeaves(state.restoreTree);
        if (!restoreLeaves.includes(newTile)) {
          const newRestoreTree =
            createBalancedTreeFromLeaves([...restoreLeaves, newTile]) ?? state.restoreTree;
          return { mosaicTree: newMosaicTree, restoreTree: newRestoreTree };
        }
      }

      return { mosaicTree: newMosaicTree };
    }),

  removeTile: (sessionId) =>
    set((state) => {
      const target = tileId(sessionId);
      const current = state.mosaicTree;
      if (!current) return state;

      // If maximized and removing the maximized tile, restore from restoreTree minus this tile
      if (state.restoreTree && typeof current === 'string' && current === target) {
        const newRestoreTree = removeLeaf(state.restoreTree, target);
        return { mosaicTree: newRestoreTree, restoreTree: null };
      }

      if (typeof current === 'string') {
        return current === target ? { mosaicTree: null } : state;
      }

      return { mosaicTree: removeLeaf(current, target) };
    }),

  removeAllTiles: () => set({ mosaicTree: null }),

  replaceTile: (oldSessionId, newSessionId) =>
    set((state) => {
      if (!state.mosaicTree) return state;
      return {
        mosaicTree: replaceLeaf(state.mosaicTree, tileId(oldSessionId), tileId(newSessionId)),
      };
    }),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  toggleSidebar: () => {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
    get().persist();
  },

  setActiveSidebarTab: (tab) => {
    set({ activeSidebarTab: tab });
    get().persist();
  },

  setShowActivityTab: (show) => {
    const updates: Partial<LayoutState> = { showActivityTab: show };
    // If hiding the activity tab while it is active, fall back to sessions.
    if (!show && get().activeSidebarTab === 'activity') {
      updates.activeSidebarTab = 'sessions';
    }
    set(updates);
    window.mcode.preferences.set('showActivityTab', String(show)).catch(console.error);
  },

  setViewMode: (mode) => {
    set({
      viewMode: mode,
      kanbanExpandedSessionId: null,
      kanbanOpenFiles: [],
      kanbanActiveFile: null,
    });
    window.mcode.preferences.set('viewMode', mode).catch(console.error);
  },

  expandKanbanSession: (sessionId) => set({ kanbanExpandedSessionId: sessionId }),

  clearKanbanExpand: () => set({ kanbanExpandedSessionId: null }),

  openKanbanFile: (absolutePath) =>
    set((state) => {
      if (state.kanbanOpenFiles.includes(absolutePath)) {
        return { kanbanActiveFile: absolutePath };
      }
      return {
        kanbanOpenFiles: [...state.kanbanOpenFiles, absolutePath],
        kanbanActiveFile: absolutePath,
      };
    }),

  closeKanbanFile: (absolutePath) =>
    set((state) => {
      const files = state.kanbanOpenFiles.filter((f) => f !== absolutePath);
      let activeFile = state.kanbanActiveFile;
      if (activeFile === absolutePath) {
        // Switch to the previous tab, or next, or null
        const idx = state.kanbanOpenFiles.indexOf(absolutePath);
        activeFile = files[Math.min(idx, files.length - 1)] ?? null;
      }
      return { kanbanOpenFiles: files, kanbanActiveFile: activeFile };
    }),

  setKanbanActiveFile: (absolutePath) => set({ kanbanActiveFile: absolutePath }),

  clearKanbanFiles: () => set({ kanbanOpenFiles: [], kanbanActiveFile: null }),

  setKanbanSplitRatio: (ratio) => set({ kanbanSplitRatio: ratio }),

  setSessionFilterQuery: (query) => set({ sessionFilterQuery: query }),

  setSplitIntent: (intent) => set({ splitIntent: intent }),

  setShowNewSessionDialog: (show) => set({ showNewSessionDialog: show }),
  setShowKeyboardShortcuts: (show) => set({ showKeyboardShortcuts: show }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowAccountsDialog: (show) => set({ showAccountsDialog: show }),
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowCreateTaskDialog: (show) => set({ showCreateTaskDialog: show }),

  openQuickOpen: (mode) => set({ quickOpenInitialMode: mode, showCommandPalette: true }),

  addFileViewer: (absolutePath, options) => {
    // Store pending line target if provided
    if (options?.line) {
      set({ pendingFileLine: { path: absolutePath, line: options.line } });
    }

    // In kanban mode, use the kanban file viewer instead of mosaic tiles
    if (get().viewMode === 'kanban') {
      get().openKanbanFile(absolutePath);
      return;
    }
    set((state) => {
      const newTile = fileTileId(absolutePath);
      const current = state.mosaicTree;

      if (!current) {
        return { mosaicTree: newTile };
      }

      // If tile already exists, don't duplicate
      const leaves = getLeaves(current);
      if (leaves.includes(newTile)) {
        return state;
      }

      const allLeaves = [...leaves, newTile];
      return {
        mosaicTree: createBalancedTreeFromLeaves(allLeaves) ?? newTile,
      };
    });
  },

  consumePendingFileLine: (path) => {
    const pending = get().pendingFileLine;
    if (pending && pending.path === path) {
      set({ pendingFileLine: null });
      return pending.line;
    }
    return null;
  },

  removeFileTile: (absolutePath) => {
    if (get().viewMode === 'kanban') {
      get().closeKanbanFile(absolutePath);
      return;
    }
    set((state) => {
      const target = fileTileId(absolutePath);
      if (!state.mosaicTree) return state;
      const result = removeLeaf(state.mosaicTree, target);
      return { mosaicTree: result };
    });
  },

  addDiffViewer: (absolutePath, commitHash?) => {
    if (get().viewMode === 'kanban') {
      // Reuse kanban file viewer for diffs (best available surface)
      get().openKanbanFile(absolutePath);
      return;
    }
    set((state) => {
      const newTile = commitHash
        ? commitDiffTileId(absolutePath, commitHash)
        : diffTileId(absolutePath);
      const current = state.mosaicTree;

      if (!current) {
        return { mosaicTree: newTile };
      }

      const leaves = getLeaves(current);
      if (leaves.includes(newTile)) {
        return state;
      }

      const allLeaves = [...leaves, newTile];
      return {
        mosaicTree: createBalancedTreeFromLeaves(allLeaves) ?? newTile,
      };
    });
  },

  removeDiffTile: (absolutePath) => {
    set((state) => {
      const target = diffTileId(absolutePath);
      if (!state.mosaicTree) return state;
      const result = removeLeaf(state.mosaicTree, target);
      return { mosaicTree: result };
    });
  },

  stripFileTiles: () =>
    set((state) => {
      if (!state.mosaicTree) return state;

      function stripNode(node: MosaicNode<string>): MosaicNode<string> | null {
        if (typeof node === 'string') {
          return node.startsWith(FILE_TILE_PREFIX) || node.startsWith(DIFF_TILE_PREFIX) || node.startsWith(COMMIT_DIFF_TILE_PREFIX)
            ? null
            : node;
        }
        if (node.type === 'split') {
          const newChildren: MosaicNode<string>[] = [];
          const newPercentages: number[] = [];
          let removedPct = 0;
          let anyChanged = false;
          for (let i = 0; i < node.children.length; i++) {
            const child = node.children[i];
            const result = stripNode(child);
            const pct = node.splitPercentages?.[i] ?? 100 / node.children.length;
            if (result !== child) anyChanged = true;
            if (result !== null) {
              newChildren.push(result);
              newPercentages.push(pct);
            } else {
              removedPct += pct;
            }
          }
          if (!anyChanged) return node; // nothing removed in this subtree — return same reference
          if (newChildren.length === 0) return null;
          if (newChildren.length === 1) return newChildren[0];
          const redistPerChild = removedPct / newChildren.length;
          return { ...node, children: newChildren, splitPercentages: newPercentages.map((p) => p + redistPerChild) };
        }
        return node;
      }

      const result = stripNode(state.mosaicTree);
      if (result === state.mosaicTree) return state;
      return { mosaicTree: result };
    }),

  maximize: (sessionId) =>
    set((state) => ({
      restoreTree: state.mosaicTree,
      mosaicTree: tileId(sessionId),
    })),

  restoreFromMaximize: () =>
    set((state) => {
      if (!state.restoreTree) return state;
      // Prune dead sessions from the restore tree using current live leaves
      // We can't easily get live session IDs here, so just restore as-is.
      // Dead tiles will show "Session not found" and can be closed.
      return {
        mosaicTree: state.restoreTree,
        restoreTree: null,
      };
    }),

  removeAnyTile: (tileId) =>
    set((state) => {
      if (!state.mosaicTree) return state;
      const result = removeLeaf(state.mosaicTree, tileId);
      return { mosaicTree: result };
    }),

  persist: () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const { mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab } = get();
      const terminalPanelState = getTerminalPanelSnapshot();
      window.mcode.layout.save(mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab, terminalPanelState);
    }, LAYOUT_PERSIST_DEBOUNCE_MS);
  },

  flushPersist: () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    const { mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab } = get();
    const terminalPanelState = getTerminalPanelSnapshot();
    void window.mcode.layout.save(mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab, terminalPanelState);
  },

  restore: async () => {
    const [snapshot, viewModePref, showActivityTabPref] = await Promise.all([
      window.mcode.layout.load(),
      window.mcode.preferences.get('viewMode'),
      window.mcode.preferences.get('showActivityTab'),
    ]);
    const viewMode: ViewMode = viewModePref === 'kanban' ? 'kanban' : 'tiles';
    const showActivityTab = showActivityTabPref === 'true';
    if (snapshot) {
      // Strip legacy dashboard/stats tiles from persisted layouts
      let tree = snapshot.mosaicTree;
      if (tree) {
        const leaves = getLeaves(tree);
        const filtered = leaves.filter((l) => !LEGACY_TILE_IDS.includes(l));
        if (filtered.length < leaves.length) {
          tree = filtered.length === 0 ? null
            : filtered.length === 1 ? filtered[0]
            : createBalancedTreeFromLeaves(filtered) ?? null;
        }
      }
      set({
        mosaicTree: tree,
        sidebarWidth: snapshot.sidebarWidth,
        sidebarCollapsed: snapshot.sidebarCollapsed ?? false,
        activeSidebarTab: migrateTab(snapshot.activeSidebarTab ?? 'sessions'),
        showActivityTab,
        viewMode,
      });

      // Restore terminal panel state
      if (snapshot.terminalPanelState && typeof snapshot.terminalPanelState === 'object') {
        const { useTerminalPanelStore } = require('./terminal-panel-store') as {
          useTerminalPanelStore: { setState: (state: Record<string, unknown>) => void };
        };
        const ps = snapshot.terminalPanelState as Record<string, unknown>;
        useTerminalPanelStore.setState({
          panelHeight: typeof ps.panelHeight === 'number' ? ps.panelHeight : 200,
          panelVisible: Boolean(ps.panelVisible),
          tabGroups: ps.tabGroups ?? {},
          splitTree: ps.splitTree ?? null,
          activeTabGroupId: ps.activeTabGroupId ?? null,
          terminals: ps.terminals ?? {},
        });
      }
    } else {
      set({ viewMode, showActivityTab });
    }
  },

  pruneTiles: (liveSessionIds) =>
    set((state) => {
      if (!state.mosaicTree) return state;
      const pruned = pruneTree(state.mosaicTree, liveSessionIds);
      return { mosaicTree: pruned };
    }),
}));
