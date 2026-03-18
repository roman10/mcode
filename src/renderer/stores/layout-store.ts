import { create } from 'zustand';
import type { MosaicNode } from 'react-mosaic-component';
import {
  createBalancedTreeFromLeaves,
  getLeaves,
} from 'react-mosaic-component';
import { LAYOUT_PERSIST_DEBOUNCE_MS } from '../../shared/constants';

interface LayoutState {
  mosaicTree: MosaicNode<string> | null;
  sidebarWidth: number;

  setMosaicTree(tree: MosaicNode<string> | null): void;
  addTile(sessionId: string): void;
  removeTile(sessionId: string): void;
  removeAllTiles(): void;
  replaceTile(oldSessionId: string, newSessionId: string): void;
  setSidebarWidth(width: number): void;
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

  persist: () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const { mosaicTree, sidebarWidth } = get();
      window.mcode.layout.save(mosaicTree, sidebarWidth);
    }, LAYOUT_PERSIST_DEBOUNCE_MS);
  },

  flushPersist: () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    const { mosaicTree, sidebarWidth } = get();
    void window.mcode.layout.save(mosaicTree, sidebarWidth);
  },

  restore: async () => {
    const snapshot = await window.mcode.layout.load();
    if (snapshot) {
      set({
        mosaicTree: snapshot.mosaicTree,
        sidebarWidth: snapshot.sidebarWidth,
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
