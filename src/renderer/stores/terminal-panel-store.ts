import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SplitDirection = 'horizontal' | 'vertical';

export type PanelNode =
  | { type: 'leaf'; tabGroupId: string }
  | {
    type: 'split';
    direction: SplitDirection;
    children: [PanelNode, PanelNode];
    ratio: number; // 0-1, position of divider
  };

export interface TabGroup {
  id: string;
  terminalIds: string[]; // ordered tab list
  activeTerminalId: string;
}

export interface TerminalEntry {
  sessionId: string;
  label: string;
  cwd: string;
  repo: string; // basename(cwd)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PANEL_HEIGHT = 200;

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface TerminalPanelState {
  // Panel chrome
  panelVisible: boolean;
  panelHeight: number;

  // Layout
  tabGroups: Record<string, TabGroup>;
  splitTree: PanelNode | null;
  activeTabGroupId: string | null;
  focusInPanel: boolean;

  // Terminals
  terminals: Record<string, TerminalEntry>;

  // --- Actions ---

  // Terminal lifecycle
  addTerminal(entry: TerminalEntry, tabGroupId?: string): void;
  removeTerminal(sessionId: string): void;
  activateTerminal(sessionId: string): void;
  updateTerminalLabel(sessionId: string, label: string): void;

  // Tab group management
  activateTabGroup(tabGroupId: string): void;
  cycleTab(direction: 1 | -1): void;

  // Split operations
  splitTabGroup(tabGroupId: string, direction: SplitDirection): void;
  setSplitRatio(parentNode: PanelNode, ratio: number): void;

  // Panel chrome
  setPanelVisible(visible: boolean): void;
  togglePanelVisible(): void;
  setPanelHeight(height: number): void;
  setFocusInPanel(focused: boolean): void;

  // Queries
  getTerminal(sessionId: string): TerminalEntry | undefined;
  getActiveTerminal(): TerminalEntry | undefined;
  getActiveTabGroup(): TabGroup | undefined;
  getAllTerminalSessionIds(): string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomUUID();
}

/** Create a default tab group containing a single terminal. */
function makeTabGroup(terminalId: string): TabGroup {
  return {
    id: generateId(),
    terminalIds: [terminalId],
    activeTerminalId: terminalId,
  };
}

/** Remove a terminal from all tab groups and clean up empty groups. */
function pruneTerminalFromGroups(
  tabGroups: Record<string, TabGroup>,
  splitTree: PanelNode | null,
  sessionId: string,
): { tabGroups: Record<string, TabGroup>; splitTree: PanelNode | null } {
  const updated: Record<string, TabGroup> = {};
  const emptyGroupIds: string[] = [];

  for (const [id, group] of Object.entries(tabGroups)) {
    const filtered = group.terminalIds.filter((tid) => tid !== sessionId);
    if (filtered.length === 0) {
      emptyGroupIds.push(id);
    } else {
      updated[id] = {
        ...group,
        terminalIds: filtered,
        activeTerminalId:
          group.activeTerminalId === sessionId ? filtered[0] : group.activeTerminalId,
      };
    }
  }

  // Prune empty groups from split tree
  let newTree = splitTree;
  for (const gid of emptyGroupIds) {
    newTree = removeLeafFromTree(newTree, gid);
  }

  return { tabGroups: updated, splitTree: newTree };
}

/** Remove a leaf (tab group) from the split tree, promoting siblings. */
function removeLeafFromTree(tree: PanelNode | null, tabGroupId: string): PanelNode | null {
  if (!tree) return null;
  if (tree.type === 'leaf') {
    return tree.tabGroupId === tabGroupId ? null : tree;
  }
  // Split node
  const [left, right] = tree.children;
  if (left.type === 'leaf' && left.tabGroupId === tabGroupId) return right;
  if (right.type === 'leaf' && right.tabGroupId === tabGroupId) return left;
  // Recurse
  const newLeft = removeLeafFromTree(left, tabGroupId);
  const newRight = removeLeafFromTree(right, tabGroupId);
  if (!newLeft) return newRight;
  if (!newRight) return newLeft;
  return { ...tree, children: [newLeft, newRight] };
}

/** Find the tab group that contains a given terminal. */
function findGroupForTerminal(
  tabGroups: Record<string, TabGroup>,
  sessionId: string,
): TabGroup | undefined {
  return Object.values(tabGroups).find((g) => g.terminalIds.includes(sessionId));
}

/** Replace a leaf node in the split tree with a new subtree. */
function replaceLeafInTree(tree: PanelNode | null, tabGroupId: string, replacement: PanelNode): PanelNode | null {
  if (!tree) return replacement;
  if (tree.type === 'leaf') {
    return tree.tabGroupId === tabGroupId ? replacement : tree;
  }
  return {
    ...tree,
    children: [
      replaceLeafInTree(tree.children[0], tabGroupId, replacement) ?? tree.children[0],
      replaceLeafInTree(tree.children[1], tabGroupId, replacement) ?? tree.children[1],
    ],
  };
}

/** Collect all tab group IDs from a split tree in left-to-right order. */
function collectLeafIds(node: PanelNode | null): string[] {
  if (!node) return [];
  if (node.type === 'leaf') return [node.tabGroupId];
  return [...collectLeafIds(node.children[0]), ...collectLeafIds(node.children[1])];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTerminalPanelStore = create<TerminalPanelState>((set, get) => ({
  // Initial state
  panelVisible: false,
  panelHeight: DEFAULT_PANEL_HEIGHT,
  tabGroups: {},
  splitTree: null,
  activeTabGroupId: null,
  focusInPanel: false,
  terminals: {},

  // ---------------------------------------------------------------------------
  // Terminal lifecycle
  // ---------------------------------------------------------------------------

  addTerminal: (entry, tabGroupId) =>
    set((state) => {
      const terminals = { ...state.terminals, [entry.sessionId]: entry };
      const tabGroups = { ...state.tabGroups };
      let splitTree = state.splitTree;
      let activeTabGroupId = state.activeTabGroupId;

      // Find or create target tab group
      const targetId = tabGroupId ?? activeTabGroupId;
      const targetGroup = targetId ? tabGroups[targetId] : undefined;

      if (targetGroup) {
        // Add to existing group
        tabGroups[targetGroup.id] = {
          ...targetGroup,
          terminalIds: [...targetGroup.terminalIds, entry.sessionId],
          activeTerminalId: entry.sessionId,
        };
      } else {
        // Create new group
        const group = makeTabGroup(entry.sessionId);
        tabGroups[group.id] = group;
        activeTabGroupId = group.id;
        // Add leaf to split tree
        const newLeaf: PanelNode = { type: 'leaf', tabGroupId: group.id };
        splitTree = splitTree
          ? {
            type: 'split',
            direction: 'horizontal',
            children: [splitTree, newLeaf],
            ratio: 0.5,
          }
          : newLeaf;
      }

      return {
        terminals,
        tabGroups,
        splitTree,
        activeTabGroupId,
        panelVisible: true,
      };
    }),

  removeTerminal: (sessionId) =>
    set((state) => {
      const { [sessionId]: _removed, ...terminals } = state.terminals;
      const { tabGroups, splitTree } = pruneTerminalFromGroups(
        state.tabGroups,
        state.splitTree,
        sessionId,
      );

      // Update activeTabGroupId if the active group was removed
      let activeTabGroupId = state.activeTabGroupId;
      if (activeTabGroupId && !tabGroups[activeTabGroupId]) {
        const leafIds = collectLeafIds(splitTree);
        activeTabGroupId = leafIds[0] ?? null;
      }

      const hasTerminals = Object.keys(terminals).length > 0;
      const panelVisible = hasTerminals ? state.panelVisible : false;
      return {
        terminals,
        tabGroups,
        splitTree,
        activeTabGroupId,
        panelVisible,
      };
    }),

  activateTerminal: (sessionId) =>
    set((state) => {
      const group = findGroupForTerminal(state.tabGroups, sessionId);
      if (!group) return state;
      return {
        tabGroups: {
          ...state.tabGroups,
          [group.id]: { ...group, activeTerminalId: sessionId },
        },
        activeTabGroupId: group.id,
        panelVisible: true,
      };
    }),

  updateTerminalLabel: (sessionId, label) =>
    set((state) => {
      const entry = state.terminals[sessionId];
      if (!entry) return state;
      return {
        terminals: { ...state.terminals, [sessionId]: { ...entry, label } },
      };
    }),

  // ---------------------------------------------------------------------------
  // Tab group management
  // ---------------------------------------------------------------------------

  activateTabGroup: (tabGroupId) =>
    set({ activeTabGroupId: tabGroupId }),

  cycleTab: (direction) =>
    set((state) => {
      const group = state.activeTabGroupId ? state.tabGroups[state.activeTabGroupId] : undefined;
      if (!group || group.terminalIds.length <= 1) return state;

      const idx = group.terminalIds.indexOf(group.activeTerminalId);
      const nextIdx =
        (idx + direction + group.terminalIds.length) % group.terminalIds.length;
      return {
        tabGroups: {
          ...state.tabGroups,
          [group.id]: { ...group, activeTerminalId: group.terminalIds[nextIdx] },
        },
      };
    }),

  // ---------------------------------------------------------------------------
  // Split operations
  // ---------------------------------------------------------------------------

  splitTabGroup: (tabGroupId, direction) => {
    const state = get();
    const group = state.tabGroups[tabGroupId];
    if (!group) return;

    const newGroupId = generateId();
    const newGroup: TabGroup = {
      id: newGroupId,
      terminalIds: [],
      activeTerminalId: '',
    };

    const tabGroups = { ...state.tabGroups, [newGroup.id]: newGroup };
    const newLeaf: PanelNode = { type: 'leaf', tabGroupId: newGroup.id };
    const splitTree = replaceLeafInTree(state.splitTree, tabGroupId, {
      type: 'split',
      direction,
      children: [{ type: 'leaf', tabGroupId }, newLeaf],
      ratio: 0.5,
    });

    set({ tabGroups, splitTree, activeTabGroupId: newGroupId });

    // Create a terminal in the new group (explicitly targeting it by ID)
    import('../utils/session-actions').then(({ createTerminalSession }) => {
      createTerminalSession(newGroupId).catch(console.error);
    });
  },

  setSplitRatio: (_parentNode, ratio) =>
    set((state) => {
      // For Phase 3 simplicity, we update the top-level split ratio
      // A full implementation would traverse and match the parentNode
      if (state.splitTree?.type === 'split') {
        return {
          splitTree: { ...state.splitTree, ratio: Math.max(0.1, Math.min(0.9, ratio)) },
        };
      }
      return state;
    }),

  // ---------------------------------------------------------------------------
  // Panel chrome
  // ---------------------------------------------------------------------------

  setPanelVisible: (visible) => set({ panelVisible: visible }),
  togglePanelVisible: () => set((state) => ({ panelVisible: !state.panelVisible })),
  setPanelHeight: (height) => set({ panelHeight: height }),
  setFocusInPanel: (focused) => set({ focusInPanel: focused }),

  // ---------------------------------------------------------------------------
  // Queries (non-mutating — access via get())
  // ---------------------------------------------------------------------------

  getTerminal: (sessionId) => get().terminals[sessionId],
  getActiveTerminal: () => {
    const state = get();
    const group = state.activeTabGroupId ? state.tabGroups[state.activeTabGroupId] : undefined;
    if (!group) return undefined;
    return state.terminals[group.activeTerminalId];
  },
  getActiveTabGroup: () => {
    const state = get();
    return state.activeTabGroupId ? state.tabGroups[state.activeTabGroupId] : undefined;
  },
  getAllTerminalSessionIds: () => Object.keys(get().terminals),
}));
