import { create } from 'zustand';
import type { MosaicNode } from 'react-mosaic-component';
import {
  createBalancedTreeFromLeaves,
  getLeaves,
} from 'react-mosaic-component';
import { LAYOUT_PERSIST_DEBOUNCE_MS } from '../../shared/constants';
import type { SidebarTab } from '../../shared/types';

/** Legacy tile IDs — stripped from persisted layouts on restore. */
const LEGACY_TILE_IDS = ['dashboard', 'commit-stats', 'token-stats'];

export const FILE_TILE_PREFIX = 'file:';

export function filePathFromTileId(tile: string): string | null {
  if (tile.startsWith(FILE_TILE_PREFIX)) {
    return tile.slice(FILE_TILE_PREFIX.length);
  }
  return null;
}

function fileTileId(absolutePath: string): string {
  return `${FILE_TILE_PREFIX}${absolutePath}`;
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
  splitIntent: SplitIntent | null;
  showNewSessionDialog: boolean;
  showKeyboardShortcuts: boolean;
  showSettings: boolean;
  showAccountsDialog: boolean;
  showCommandPalette: boolean;
  showCreateTaskDialog: boolean;
  quickOpenInitialMode: 'files' | 'commands';
  restoreTree: MosaicNode<string> | null;

  setMosaicTree(tree: MosaicNode<string> | null): void;
  addTile(sessionId: string): void;
  addTileAdjacent(anchorSessionId: string, newSessionId: string, direction: 'row' | 'column'): void;
  removeTile(sessionId: string): void;
  removeAllTiles(): void;
  replaceTile(oldSessionId: string, newSessionId: string): void;
  setSidebarWidth(width: number): void;
  toggleSidebar(): void;
  setActiveSidebarTab(tab: SidebarTab): void;
  setSplitIntent(intent: SplitIntent | null): void;
  setShowNewSessionDialog(show: boolean): void;
  setShowKeyboardShortcuts(show: boolean): void;
  setShowSettings(show: boolean): void;
  setShowAccountsDialog(show: boolean): void;
  setShowCommandPalette(show: boolean): void;
  setShowCreateTaskDialog(show: boolean): void;
  openQuickOpen(mode: 'files' | 'commands'): void;
  addFileViewer(absolutePath: string): void;
  removeFileTile(absolutePath: string): void;
  stripFileTiles(): void;
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

export function sessionIdFromTileId(tile: string): string | null {
  if (tile.startsWith('session:')) {
    return tile.slice('session:'.length);
  }
  return null;
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

/** Remove a specific leaf from the tree, rebalancing as needed. */
function removeLeaf(
  node: MosaicNode<string>,
  target: string,
): MosaicNode<string> | null {
  if (typeof node === 'string') {
    return node === target ? null : node;
  }

  const leaves = getLeaves(node).filter((l) => l !== target);
  if (leaves.length === 0) return null;
  if (leaves.length === 1) return leaves[0];
  return createBalancedTreeFromLeaves(leaves) ?? null;
}

/** Remove nodes referencing dead sessions from the mosaic tree. */
function pruneTree(
  node: MosaicNode<string>,
  liveIds: Set<string>,
): MosaicNode<string> | null {
  // Leaf node
  if (typeof node === 'string') {
    const sid = sessionIdFromTileId(node);
    if (sid && !liveIds.has(sid)) return null;
    return node;
  }

  // Use getLeaves to collect surviving leaves then rebuild
  const leaves = getLeaves(node).filter((leaf) => {
    const sid = sessionIdFromTileId(leaf);
    return !sid || liveIds.has(sid);
  });

  if (leaves.length === 0) return null;
  if (leaves.length === 1) return leaves[0];
  return createBalancedTreeFromLeaves(leaves) ?? null;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  mosaicTree: null,
  sidebarWidth: 280,
  sidebarCollapsed: false,
  activeSidebarTab: 'sessions' as SidebarTab,
  splitIntent: null,
  showNewSessionDialog: false,
  showKeyboardShortcuts: false,
  showSettings: false,
  showAccountsDialog: false,
  showCommandPalette: false,
  showCreateTaskDialog: false,
  quickOpenInitialMode: 'files' as const,
  restoreTree: null,

  setMosaicTree: (tree) => set({ mosaicTree: tree }),

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
      return {
        mosaicTree: createBalancedTreeFromLeaves(allLeaves) ?? newTile,
      };
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
      if (!leaves.includes(anchorTile)) {
        // Anchor not found — fall back to balanced insert
        const allLeaves = [...leaves, newTile];
        return { mosaicTree: createBalancedTreeFromLeaves(allLeaves) ?? newTile };
      }

      return {
        mosaicTree: insertAdjacentLeaf(current, anchorTile, newTile, direction),
      };
    }),

  removeTile: (sessionId) =>
    set((state) => {
      const target = tileId(sessionId);
      const current = state.mosaicTree;
      if (!current) return state;

      if (typeof current === 'string') {
        return current === target ? { mosaicTree: null } : state;
      }

      const leaves = getLeaves(current).filter((l) => l !== target);
      if (leaves.length === 0) return { mosaicTree: null };

      return {
        mosaicTree:
          leaves.length === 1
            ? leaves[0]
            : createBalancedTreeFromLeaves(leaves) ?? null,
      };
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

  setSplitIntent: (intent) => set({ splitIntent: intent }),

  setShowNewSessionDialog: (show) => set({ showNewSessionDialog: show }),
  setShowKeyboardShortcuts: (show) => set({ showKeyboardShortcuts: show }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowAccountsDialog: (show) => set({ showAccountsDialog: show }),
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowCreateTaskDialog: (show) => set({ showCreateTaskDialog: show }),

  openQuickOpen: (mode) => set({ quickOpenInitialMode: mode, showCommandPalette: true }),

  addFileViewer: (absolutePath) =>
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
    }),

  removeFileTile: (absolutePath) =>
    set((state) => {
      const target = fileTileId(absolutePath);
      if (!state.mosaicTree) return state;
      const result = removeLeaf(state.mosaicTree, target);
      return { mosaicTree: result };
    }),

  stripFileTiles: () =>
    set((state) => {
      if (!state.mosaicTree) return state;
      const allLeaves = getLeaves(state.mosaicTree);
      const leaves = allLeaves.filter(
        (leaf) => !leaf.startsWith(FILE_TILE_PREFIX),
      );
      if (leaves.length === allLeaves.length) return state;
      if (leaves.length === 0) return { mosaicTree: null };
      if (leaves.length === 1) return { mosaicTree: leaves[0] };
      return { mosaicTree: createBalancedTreeFromLeaves(leaves) ?? null };
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
      window.mcode.layout.save(mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab);
    }, LAYOUT_PERSIST_DEBOUNCE_MS);
  },

  flushPersist: () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    const { mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab } = get();
    void window.mcode.layout.save(mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab);
  },

  restore: async () => {
    const snapshot = await window.mcode.layout.load();
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
        activeSidebarTab: snapshot.activeSidebarTab ?? 'sessions',
      });
    }
  },

  pruneTiles: (liveSessionIds) =>
    set((state) => {
      if (!state.mosaicTree) return state;
      const pruned = pruneTree(state.mosaicTree, liveSessionIds);
      return { mosaicTree: pruned };
    }),
}));
