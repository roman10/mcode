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
import { useSessionStore } from './session-store';
import { useTerminalPanelStore, type PanelNode, type TabGroup, type TerminalEntry } from './terminal-panel-store';

/** Legacy tile id from when the stats dashboard was a mosaic tile; stripped on restore. */
const LEGACY_STATS_DASHBOARD_TILE = 'stats-dashboard:main';

/** Validate a persisted sidebar tab value, falling back to 'sessions' for unknown values. Exported for testing. */
export function migrateTab(tab: string): SidebarTab {
  const valid: SidebarTab[] = ['sessions', 'search', 'changes', 'stats', 'activity', 'todos'];
  return valid.includes(tab as SidebarTab) ? (tab as SidebarTab) : 'sessions';
}

/** Snapshot the terminal panel store for persistence. */
function getTerminalPanelSnapshot(): unknown {
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
  /** Transient overlay tree. Non-null = an overlay Mosaic above the (still
   *  rendered) background `mosaicTree`. Starts as a single leaf (the maximized
   *  tile); splitting while expanded splices new leaves in. `mosaicTree` always
   *  receives the same leaves so restore is consistent and no TerminalInstance
   *  ever unmounts (xterm Terminals, WebGL atlases, broker offsets preserved).
   *  Never persisted. */
  maximizedTree: MosaicNode<string> | null;
  pendingFileLine: { path: string; line: number } | null;
  /** Tracks the focused tile ID (session, file, or diff viewer). Transient, not persisted. */
  selectedTileId: string | null;

  setMosaicTree(tree: MosaicNode<string> | null): void;
  setSelectedTileId(id: string | null): void;
  /** Single entry point for focus changes — atomically updates selectedTileId and selectedSessionId. */
  focusTile(tileId: string | null): void;
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
  addFileViewer(absolutePath: string, options?: { line?: number }): void;
  consumePendingFileLine(path: string): number | null;
  removeFileTile(absolutePath: string): void;
  stripFileTiles(): void;
  addDiffViewer(absolutePath: string, commitHash?: string): void;
  removeDiffTile(absolutePath: string): void;
  maximize(sessionId: string): void;
  maximizeTile(tileId: string): void;
  restoreFromMaximize(): void;
  setMaximizedTree(tree: MosaicNode<string> | null): void;
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

/** Splice a new leaf into the transient overlay tree the same way it lands in
 *  mosaicTree: adjacent to an anchor when one is given and present, else
 *  balanced. Returns the tree unchanged when the overlay is inactive (null) or
 *  the leaf is already present. */
function spliceIntoOverlay(
  tree: MosaicNode<string> | null,
  newLeaf: string,
  opts?: { anchor?: string; direction?: 'row' | 'column' },
): MosaicNode<string> | null {
  if (!tree) return tree;
  const leaves = getLeaves(tree);
  if (leaves.includes(newLeaf)) return tree;
  if (opts?.anchor && opts.direction && leaves.includes(opts.anchor)) {
    return insertAdjacentLeaf(tree, opts.anchor, newLeaf, opts.direction);
  }
  return createBalancedTreeFromLeaves([...leaves, newLeaf]) ?? newLeaf;
}

/** Remove a leaf from the overlay tree, handling the single-leaf (string) case.
 *  removeLeaf already collapses single-child splits, so removing one of two
 *  overlay tiles yields a single-leaf tree (still maximized on the survivor). */
function removeFromOverlay(
  tree: MosaicNode<string> | null,
  target: string,
): MosaicNode<string> | null {
  if (!tree) return tree;
  if (typeof tree === 'string') return tree === target ? null : tree;
  return removeLeaf(tree, target);
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
  maximizedTree: null,
  pendingFileLine: null,
  selectedTileId: null,

  setMosaicTree: (tree) => set({ mosaicTree: tree }),
  setSelectedTileId: (id) => set({ selectedTileId: id }),
  focusTile: (tileId) => {
    set({ selectedTileId: tileId });
    const sid = tileId ? sessionIdFromTileId(tileId) : null;
    useSessionStore.getState().selectSession(sid);
  },

  addTile: (sessionId) =>
    set((state) => {
      const newTile = tileId(sessionId);
      const current = state.mosaicTree;

      if (!current) {
        return {
          mosaicTree: newTile,
          maximizedTree: spliceIntoOverlay(state.maximizedTree, newTile),
        };
      }

      // Check if tile already exists
      const leaves = getLeaves(current);
      if (leaves.includes(newTile)) {
        return state; // Already present
      }

      // Create a balanced tree with all existing leaves plus the new one
      const allLeaves = [...leaves, newTile];
      const newMosaicTree = createBalancedTreeFromLeaves(allLeaves) ?? newTile;

      // While expanded, mirror the new tile into the overlay so it splits the
      // expanded surface instead of burying in the hidden background tree.
      return {
        mosaicTree: newMosaicTree,
        maximizedTree: spliceIntoOverlay(state.maximizedTree, newTile),
      };
    }),

  addTileAdjacent: (anchorSessionId, newSessionId, direction) =>
    set((state) => {
      const anchorTile = tileId(anchorSessionId);
      const newTile = tileId(newSessionId);
      const current = state.mosaicTree;

      if (!current) {
        return {
          mosaicTree: newTile,
          maximizedTree: spliceIntoOverlay(state.maximizedTree, newTile, {
            anchor: anchorTile,
            direction,
          }),
        };
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

      // While expanded, split the overlay adjacent to the anchor too.
      return {
        mosaicTree: newMosaicTree,
        maximizedTree: spliceIntoOverlay(state.maximizedTree, newTile, {
          anchor: anchorTile,
          direction,
        }),
      };
    }),

  removeTile: (sessionId) =>
    set((state) => {
      const target = tileId(sessionId);
      const current = state.mosaicTree;
      if (!current) return state;

      // Drop the tile from the overlay too. removeFromOverlay collapses a
      // two-tile overlay to the survivor (stays maximized) and clears it when
      // the maximized tile itself goes away, so the overlay never desyncs.
      const nextMax = removeFromOverlay(state.maximizedTree, target);

      if (typeof current === 'string') {
        if (current !== target) return state;
        return { mosaicTree: null, maximizedTree: nextMax };
      }

      return { mosaicTree: removeLeaf(current, target), maximizedTree: nextMax };
    }),

  removeAllTiles: () => set({ mosaicTree: null, maximizedTree: null }),

  replaceTile: (oldSessionId, newSessionId) =>
    set((state) => {
      if (!state.mosaicTree) return state;
      const oldTile = tileId(oldSessionId);
      const newTile = tileId(newSessionId);
      return {
        mosaicTree: replaceLeaf(state.mosaicTree, oldTile, newTile),
        // Keep the overlay leaf valid across a CLI handoff while expanded.
        maximizedTree: state.maximizedTree
          ? replaceLeaf(state.maximizedTree, oldTile, newTile)
          : state.maximizedTree,
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
      // Drop the tiles-mode overlay state on view switch — symmetric with
      // kanbanExpandedSessionId — otherwise switching to kanban and back
      // would flash the tile briefly in its mosaic pane before re-portaling
      // into the overlay on the second render.
      maximizedTree: null,
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
    const newTile = fileTileId(absolutePath);
    set((state) => {
      const current = state.mosaicTree;

      if (!current) {
        return {
          mosaicTree: newTile,
          maximizedTree: spliceIntoOverlay(state.maximizedTree, newTile),
        };
      }

      // If tile already exists, don't duplicate
      const leaves = getLeaves(current);
      if (leaves.includes(newTile)) {
        return state;
      }

      const allLeaves = [...leaves, newTile];
      return {
        mosaicTree: createBalancedTreeFromLeaves(allLeaves) ?? newTile,
        // Opening a file while expanded splits the expanded surface too.
        maximizedTree: spliceIntoOverlay(state.maximizedTree, newTile),
      };
    });
    get().focusTile(newTile);
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
      return {
        mosaicTree: removeLeaf(state.mosaicTree, target),
        maximizedTree: removeFromOverlay(state.maximizedTree, target),
      };
    });
  },

  addDiffViewer: (absolutePath, commitHash?) => {
    if (get().viewMode === 'kanban') {
      // Reuse kanban file viewer for diffs (best available surface)
      get().openKanbanFile(absolutePath);
      return;
    }
    const newTile = commitHash
      ? commitDiffTileId(absolutePath, commitHash)
      : diffTileId(absolutePath);
    set((state) => {
      const current = state.mosaicTree;

      if (!current) {
        return {
          mosaicTree: newTile,
          maximizedTree: spliceIntoOverlay(state.maximizedTree, newTile),
        };
      }

      const leaves = getLeaves(current);
      if (leaves.includes(newTile)) {
        return state;
      }

      const allLeaves = [...leaves, newTile];
      return {
        mosaicTree: createBalancedTreeFromLeaves(allLeaves) ?? newTile,
        // Opening a diff while expanded splits the expanded surface too.
        maximizedTree: spliceIntoOverlay(state.maximizedTree, newTile),
      };
    });
    get().focusTile(newTile);
  },

  removeDiffTile: (absolutePath) => {
    set((state) => {
      const target = diffTileId(absolutePath);
      if (!state.mosaicTree) return state;
      return {
        mosaicTree: removeLeaf(state.mosaicTree, target),
        maximizedTree: removeFromOverlay(state.maximizedTree, target),
      };
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
      // Keep the overlay in sync: a maximized file/diff tile must also leave
      // the overlay when stripped, otherwise maximizedTree shows a stale leaf.
      const nextMax = state.maximizedTree ? stripNode(state.maximizedTree) : null;
      if (result === state.mosaicTree && nextMax === state.maximizedTree) return state;
      return { mosaicTree: result, maximizedTree: nextMax };
    }),

  // Maximize is a CSS overlay, not a tree restructure. The background mosaic
  // stays mounted underneath; the overlay layer above it renders maximizedTree
  // (a single leaf, or a split once you add a tile while expanded) via React
  // Portals in MosaicLayout. Keeping every tile mounted across the cycle
  // preserves xterm Terminals, WebGL atlases, broker offsets, and editor state.
  maximize: (sessionId) => get().maximizeTile(tileId(sessionId)),

  maximizeTile: (tile) => set({ maximizedTree: tile }),

  restoreFromMaximize: () => set({ maximizedTree: null }),

  setMaximizedTree: (tree) => set({ maximizedTree: tree }),

  removeAnyTile: (tileId) =>
    set((state) => {
      if (!state.mosaicTree) return state;
      return {
        mosaicTree: removeLeaf(state.mosaicTree, tileId),
        maximizedTree: removeFromOverlay(state.maximizedTree, tileId),
      };
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
      // Migrate: the stats dashboard used to live as a mosaic tile; strip any leftover leaf.
      const migratedTree = snapshot.mosaicTree
        ? removeLeaf(snapshot.mosaicTree, LEGACY_STATS_DASHBOARD_TILE)
        : snapshot.mosaicTree;
      set({
        mosaicTree: migratedTree,
        sidebarWidth: snapshot.sidebarWidth,
        sidebarCollapsed: snapshot.sidebarCollapsed ?? false,
        activeSidebarTab: migrateTab(snapshot.activeSidebarTab ?? 'sessions'),
        showActivityTab,
        viewMode,
      });

      // Restore terminal panel state
      if (snapshot.terminalPanelState && typeof snapshot.terminalPanelState === 'object') {
        const ps = snapshot.terminalPanelState as {
          panelHeight?: unknown;
          panelVisible?: unknown;
          tabGroups?: Record<string, TabGroup>;
          splitTree?: PanelNode | null;
          activeTabGroupId?: string | null;
          terminals?: Record<string, TerminalEntry>;
        };
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
      // Prune dead sessions out of the overlay too. A single-leaf overlay
      // pointing at a dead session collapses to null (overlay lifts); a split
      // collapses to the surviving tile (stays maximized).
      let nextMax = state.maximizedTree;
      if (nextMax) {
        if (typeof nextMax === 'string') {
          const sid = sessionIdFromTileId(nextMax);
          nextMax = sid !== null && !liveSessionIds.has(sid) ? null : nextMax;
        } else {
          nextMax = pruneTree(nextMax, liveSessionIds);
        }
      }
      return { mosaicTree: pruned, maximizedTree: nextMax };
    }),
}));
