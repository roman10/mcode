import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLeaves } from 'react-mosaic-component';
import type { MosaicNode } from 'react-mosaic-component';
import { setupMcodeMock } from '../mock-mcode';

const mockSelectSession = vi.fn();

// Mock session-store (used by focusTile)
vi.mock('../../../../src/renderer/stores/session-store', () => ({
  useSessionStore: {
    getState: () => ({ selectSession: mockSelectSession }),
  },
}));

// Setup window.mcode mock
setupMcodeMock();

const { useLayoutStore, migrateTab } = await import(
  '../../../../src/renderer/stores/layout-store'
);
const { sessionIdFromTileId } = await import('../../../../src/renderer/utils/tile-id');

function getTree(): MosaicNode<string> | null {
  return useLayoutStore.getState().mosaicTree;
}

function getLeafIds(): string[] {
  const tree = getTree();
  if (!tree) return [];
  if (typeof tree === 'string') return [tree];
  return getLeaves(tree);
}

function countTiles(): number {
  return getLeafIds().length;
}

describe('layout-store', () => {
  beforeEach(() => {
    mockSelectSession.mockClear();
    useLayoutStore.setState({
      mosaicTree: null,
      sidebarWidth: 280,
      sidebarCollapsed: false,
      activeSidebarTab: 'sessions',
      viewMode: 'tiles',
      kanbanExpandedSessionId: null,
      kanbanOpenFiles: [],
      kanbanActiveFile: null,
      kanbanSplitRatio: 0.5,
      splitIntent: null,
      maximizedTileId: null,
      pendingFileLine: null,
      selectedTileId: null,
    });
  });

  describe('sessionIdFromTileId', () => {
    it('extracts session ID from session: prefix', () => {
      expect(sessionIdFromTileId('session:abc-123')).toBe('abc-123');
    });

    it('returns null for non-session tiles', () => {
      expect(sessionIdFromTileId('file:/path')).toBeNull();
      expect(sessionIdFromTileId('diff:/path')).toBeNull();
      expect(sessionIdFromTileId('random')).toBeNull();
    });
  });

  describe('addTile', () => {
    it('creates a leaf when tree is null', () => {
      useLayoutStore.getState().addTile('s1');
      expect(getTree()).toBe('session:s1');
      expect(countTiles()).toBe(1);
    });

    it('creates a split when adding to existing leaf', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');

      expect(countTiles()).toBe(2);
      expect(getLeafIds()).toContain('session:s1');
      expect(getLeafIds()).toContain('session:s2');
    });

    it('does not duplicate an existing tile', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s1');

      expect(countTiles()).toBe(1);
    });

    it('handles adding multiple tiles', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      useLayoutStore.getState().addTile('s3');

      expect(countTiles()).toBe(3);
      expect(getLeafIds()).toContain('session:s1');
      expect(getLeafIds()).toContain('session:s2');
      expect(getLeafIds()).toContain('session:s3');
    });
  });

  describe('removeTile', () => {
    it('returns null when removing the only tile', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().removeTile('s1');

      expect(getTree()).toBeNull();
    });

    it('returns a leaf when removing from a 2-tile split', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      useLayoutStore.getState().removeTile('s1');

      expect(getTree()).toBe('session:s2');
    });

    it('no-ops when removing a non-existent tile', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().removeTile('nonexistent');

      expect(countTiles()).toBe(1);
    });

    it('no-ops when tree is null', () => {
      useLayoutStore.getState().removeTile('s1');
      expect(getTree()).toBeNull();
    });

    it('preserves remaining tiles when removing from 3-tile layout', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      useLayoutStore.getState().addTile('s3');
      useLayoutStore.getState().removeTile('s2');

      expect(countTiles()).toBe(2);
      expect(getLeafIds()).toContain('session:s1');
      expect(getLeafIds()).toContain('session:s3');
    });

    it('preserves parent split structure when removing from a nested split', () => {
      // Set up a tree with a known split structure and custom percentages
      const tree: MosaicNode<string> = {
        type: 'split',
        direction: 'row',
        splitPercentages: [60, 40],
        children: [
          'session:s1',
          {
            type: 'split',
            direction: 'column',
            splitPercentages: [70, 30],
            children: ['session:s2', 'session:s3'],
          },
        ],
      };
      useLayoutStore.getState().setMosaicTree(tree);
      useLayoutStore.getState().removeTile('s3');

      // Root split direction and percentages must be preserved — not reset to 50-50
      expect(getTree()).toMatchObject({
        type: 'split',
        direction: 'row',
        splitPercentages: [60, 40],
        children: ['session:s1', 'session:s2'],
      });
    });

    it('redistributes removed tile percentage to siblings', () => {
      const tree: MosaicNode<string> = {
        type: 'split',
        direction: 'row',
        splitPercentages: [33, 33, 34],
        children: ['session:s1', 'session:s2', 'session:s3'],
      };
      useLayoutStore.getState().setMosaicTree(tree);
      useLayoutStore.getState().removeTile('s2');

      const result = getTree() as Extract<MosaicNode<string>, { type: 'split' }>;
      expect(result.children).toHaveLength(2);
      // s2's 33% redistributed equally: s1 and s3 each get +16.5
      expect(result.splitPercentages?.[0]).toBeCloseTo(49.5);
      expect(result.splitPercentages?.[1]).toBeCloseTo(50.5);
    });

    it('lifts maximize and removes the leaf when removing a maximized tile', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      useLayoutStore.getState().addTile('s3');

      useLayoutStore.getState().maximize('s2');
      // maximizedTileId is now 'session:s2'; mosaicTree still has {s1, s2, s3}

      useLayoutStore.getState().removeTile('s2');

      // The leaf is gone from the tree AND the overlay is lifted, so the
      // remaining tiles render normally.
      expect(getTree()).not.toBeNull();
      expect(countTiles()).toBe(2);
      expect(getLeafIds()).toContain('session:s1');
      expect(getLeafIds()).toContain('session:s3');
      expect(getLeafIds()).not.toContain('session:s2');
      expect(useLayoutStore.getState().maximizedTileId).toBeNull();
    });

    it('sets tree to null and lifts maximize when removing the last (maximized) session', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().maximize('s1');
      useLayoutStore.getState().removeTile('s1');

      expect(getTree()).toBeNull();
      expect(useLayoutStore.getState().maximizedTileId).toBeNull();
    });

    it('leaves maximize untouched when removing a non-maximized tile', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      useLayoutStore.getState().addTile('s3');
      useLayoutStore.getState().maximize('s2');

      useLayoutStore.getState().removeTile('s1');

      expect(useLayoutStore.getState().maximizedTileId).toBe('session:s2');
      const leaves = getLeafIds();
      expect(leaves).toContain('session:s2');
      expect(leaves).toContain('session:s3');
      expect(leaves).not.toContain('session:s1');
    });
  });

  describe('removeAllTiles', () => {
    it('sets tree to null', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      useLayoutStore.getState().removeAllTiles();

      expect(getTree()).toBeNull();
    });
  });

  describe('replaceTile', () => {
    it('swaps one session for another, preserving structure', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      useLayoutStore.getState().replaceTile('s1', 's3');

      const leaves = getLeafIds();
      expect(leaves).toContain('session:s3');
      expect(leaves).toContain('session:s2');
      expect(leaves).not.toContain('session:s1');
    });

    it('no-ops when tree is null', () => {
      useLayoutStore.getState().replaceTile('s1', 's2');
      expect(getTree()).toBeNull();
    });

    it('replaces a single-tile tree', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().replaceTile('s1', 's2');

      expect(getTree()).toBe('session:s2');
    });
  });

  describe('addTileAdjacent', () => {
    it('creates leaf when tree is null (anchor ignored)', () => {
      useLayoutStore.getState().addTileAdjacent('anchor', 's1', 'row');
      expect(getTree()).toBe('session:s1');
    });

    it('inserts next to anchor when anchor exists', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTileAdjacent('s1', 's2', 'column');

      expect(countTiles()).toBe(2);
      expect(getLeafIds()).toContain('session:s1');
      expect(getLeafIds()).toContain('session:s2');
    });

    it('falls back to balanced insert when anchor not found', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTileAdjacent('nonexistent', 's2', 'row');

      expect(countTiles()).toBe(2);
      expect(getLeafIds()).toContain('session:s2');
    });

    it('does not duplicate an existing tile', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTileAdjacent('s1', 's1', 'row');

      expect(countTiles()).toBe(1);
    });
  });

  describe('maximize and restore', () => {
    it('sets maximizedTileId without touching the tree (overlay model)', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      const beforeTree = getTree();

      useLayoutStore.getState().maximize('s1');

      // Tree is preserved so every TerminalInstance stays mounted across the
      // cycle. The overlay is driven entirely by maximizedTileId.
      expect(getTree()).toEqual(beforeTree);
      expect(useLayoutStore.getState().maximizedTileId).toBe('session:s1');
    });

    it('clears maximizedTileId on restore (tree was never changed)', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      const beforeTree = getTree();

      useLayoutStore.getState().maximize('s1');
      useLayoutStore.getState().restoreFromMaximize();

      expect(getTree()).toEqual(beforeTree);
      expect(useLayoutStore.getState().maximizedTileId).toBeNull();
    });

    it('adds new tile to mosaicTree while maximized; maximizedTileId untouched', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      useLayoutStore.getState().addTile('s3');
      useLayoutStore.getState().maximize('s1');

      useLayoutStore.getState().addTile('s4');

      // All tiles live in the single tree; the new one sits hidden under
      // the overlay until the user restores.
      const leaves = getLeafIds();
      expect(leaves).toContain('session:s1');
      expect(leaves).toContain('session:s2');
      expect(leaves).toContain('session:s3');
      expect(leaves).toContain('session:s4');
      expect(useLayoutStore.getState().maximizedTileId).toBe('session:s1');
    });

    it('restoring after adding tiles while maximized exposes them all', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      useLayoutStore.getState().maximize('s1');

      useLayoutStore.getState().addTile('s3');
      useLayoutStore.getState().restoreFromMaximize();

      const leaves = getLeafIds();
      expect(leaves).toContain('session:s1');
      expect(leaves).toContain('session:s2');
      expect(leaves).toContain('session:s3');
      expect(useLayoutStore.getState().maximizedTileId).toBeNull();
    });

    it('removeAnyTile lifts maximize when removing the maximized tile', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      useLayoutStore.getState().maximize('s1');

      useLayoutStore.getState().removeAnyTile('session:s1');

      expect(useLayoutStore.getState().maximizedTileId).toBeNull();
      expect(getLeafIds()).not.toContain('session:s1');
      expect(getLeafIds()).toContain('session:s2');
    });
  });

  describe('pruneTiles', () => {
    it('removes dead session tiles', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      useLayoutStore.getState().addTile('s3');

      useLayoutStore.getState().pruneTiles(new Set(['s1', 's3']));

      const leaves = getLeafIds();
      expect(leaves).toContain('session:s1');
      expect(leaves).toContain('session:s3');
      expect(leaves).not.toContain('session:s2');
    });

    it('returns null when all tiles are pruned', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().pruneTiles(new Set());

      expect(getTree()).toBeNull();
    });

    it('no-ops when tree is null', () => {
      useLayoutStore.getState().pruneTiles(new Set(['s1']));
      expect(getTree()).toBeNull();
    });
  });

  describe('kanban state', () => {
    it('openKanbanFile adds and activates file', () => {
      useLayoutStore.getState().openKanbanFile('/a.ts');

      const state = useLayoutStore.getState();
      expect(state.kanbanOpenFiles).toEqual(['/a.ts']);
      expect(state.kanbanActiveFile).toBe('/a.ts');
    });

    it('openKanbanFile does not duplicate, just activates', () => {
      useLayoutStore.getState().openKanbanFile('/a.ts');
      useLayoutStore.getState().openKanbanFile('/b.ts');
      useLayoutStore.getState().openKanbanFile('/a.ts');

      expect(useLayoutStore.getState().kanbanOpenFiles).toEqual(['/a.ts', '/b.ts']);
      expect(useLayoutStore.getState().kanbanActiveFile).toBe('/a.ts');
    });

    it('closeKanbanFile removes and auto-selects neighbor', () => {
      useLayoutStore.getState().openKanbanFile('/a.ts');
      useLayoutStore.getState().openKanbanFile('/b.ts');
      useLayoutStore.getState().openKanbanFile('/c.ts');
      useLayoutStore.getState().setKanbanActiveFile('/b.ts');

      useLayoutStore.getState().closeKanbanFile('/b.ts');

      const state = useLayoutStore.getState();
      expect(state.kanbanOpenFiles).toEqual(['/a.ts', '/c.ts']);
      // Should select the next file at the same index
      expect(state.kanbanActiveFile).toBe('/c.ts');
    });

    it('closeKanbanFile sets null when last file closed', () => {
      useLayoutStore.getState().openKanbanFile('/a.ts');
      useLayoutStore.getState().closeKanbanFile('/a.ts');

      expect(useLayoutStore.getState().kanbanActiveFile).toBeNull();
    });

    it('clearKanbanFiles resets all', () => {
      useLayoutStore.getState().openKanbanFile('/a.ts');
      useLayoutStore.getState().openKanbanFile('/b.ts');
      useLayoutStore.getState().clearKanbanFiles();

      expect(useLayoutStore.getState().kanbanOpenFiles).toEqual([]);
      expect(useLayoutStore.getState().kanbanActiveFile).toBeNull();
    });
  });

  describe('setViewMode', () => {
    it('switches mode and clears kanban state', () => {
      useLayoutStore.getState().expandKanbanSession('s1');
      useLayoutStore.getState().openKanbanFile('/a.ts');

      useLayoutStore.getState().setViewMode('kanban');

      const state = useLayoutStore.getState();
      expect(state.viewMode).toBe('kanban');
      expect(state.kanbanExpandedSessionId).toBeNull();
      expect(state.kanbanOpenFiles).toEqual([]);
      expect(state.kanbanActiveFile).toBeNull();
    });

    it('clears tiles-mode maximize on view switch', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().maximize('s1');

      useLayoutStore.getState().setViewMode('kanban');

      expect(useLayoutStore.getState().maximizedTileId).toBeNull();
    });
  });

  describe('file viewer tiles', () => {
    it('addFileViewer adds file tile in tiles mode', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addFileViewer('/test.ts');

      expect(getLeafIds()).toContain('file:/test.ts');
    });

    it('addFileViewer uses kanban files in kanban mode', () => {
      useLayoutStore.getState().setViewMode('kanban');
      useLayoutStore.getState().addFileViewer('/test.ts');

      expect(useLayoutStore.getState().kanbanOpenFiles).toContain('/test.ts');
      expect(getLeafIds()).not.toContain('file:/test.ts');
    });

    it('removeFileTile removes file tile', () => {
      useLayoutStore.getState().addFileViewer('/test.ts');
      useLayoutStore.getState().removeFileTile('/test.ts');

      expect(getLeafIds()).not.toContain('file:/test.ts');
    });

    it('stripFileTiles removes all file/diff tiles', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addFileViewer('/a.ts');
      useLayoutStore.getState().addDiffViewer('/b.ts');

      useLayoutStore.getState().stripFileTiles();

      const leaves = getLeafIds();
      expect(leaves).toContain('session:s1');
      expect(leaves).toHaveLength(1);
    });
  });

  describe('pendingFileLine', () => {
    it('stores and consumes pending line', () => {
      useLayoutStore.getState().addFileViewer('/test.ts', { line: 42 });

      const line = useLayoutStore.getState().consumePendingFileLine('/test.ts');
      expect(line).toBe(42);

      // Second consume returns null
      const again = useLayoutStore.getState().consumePendingFileLine('/test.ts');
      expect(again).toBeNull();
    });

    it('returns null for non-matching path', () => {
      useLayoutStore.getState().addFileViewer('/test.ts', { line: 42 });

      expect(useLayoutStore.getState().consumePendingFileLine('/other.ts')).toBeNull();
    });
  });
});

describe('focusTile', () => {
  beforeEach(() => {
    mockSelectSession.mockClear();
    useLayoutStore.setState({ selectedTileId: null });
  });

  it('sets selectedTileId and calls selectSession for a session tile', () => {
    useLayoutStore.getState().focusTile('session:abc');
    expect(useLayoutStore.getState().selectedTileId).toBe('session:abc');
    expect(mockSelectSession).toHaveBeenCalledWith('abc');
  });

  it('sets selectedTileId and calls selectSession(null) for a file tile', () => {
    useLayoutStore.getState().focusTile('file:/test.ts');
    expect(useLayoutStore.getState().selectedTileId).toBe('file:/test.ts');
    expect(mockSelectSession).toHaveBeenCalledWith(null);
  });

  it('clears both when called with null', () => {
    useLayoutStore.setState({ selectedTileId: 'session:abc' });
    useLayoutStore.getState().focusTile(null);
    expect(useLayoutStore.getState().selectedTileId).toBeNull();
    expect(mockSelectSession).toHaveBeenCalledWith(null);
  });
});

describe('addFileViewer auto-focus', () => {
  beforeEach(() => {
    mockSelectSession.mockClear();
    useLayoutStore.setState({ mosaicTree: null, selectedTileId: null, viewMode: 'tiles' });
  });

  it('sets selectedTileId to the new file tile', () => {
    useLayoutStore.getState().addFileViewer('/test.ts');
    expect(useLayoutStore.getState().selectedTileId).toBe('file:/test.ts');
    expect(mockSelectSession).toHaveBeenCalledWith(null);
  });

  it('re-selects an existing file tile', () => {
    useLayoutStore.getState().addFileViewer('/test.ts');
    mockSelectSession.mockClear();
    useLayoutStore.setState({ selectedTileId: null });
    useLayoutStore.getState().addFileViewer('/test.ts');
    expect(useLayoutStore.getState().selectedTileId).toBe('file:/test.ts');
  });
});

describe('addDiffViewer auto-focus', () => {
  beforeEach(() => {
    mockSelectSession.mockClear();
    useLayoutStore.setState({ mosaicTree: null, selectedTileId: null, viewMode: 'tiles' });
  });

  it('sets selectedTileId to the new diff tile', () => {
    useLayoutStore.getState().addDiffViewer('/test.ts');
    expect(useLayoutStore.getState().selectedTileId).toBe('diff:/test.ts');
  });

  it('sets selectedTileId for commit diff tile', () => {
    useLayoutStore.getState().addDiffViewer('/test.ts', 'abc123');
    expect(useLayoutStore.getState().selectedTileId).toBe('commit-diff:abc123:/test.ts');
  });
});

describe('migrateTab', () => {
  it('passes valid tabs through unchanged', () => {
    expect(migrateTab('sessions')).toBe('sessions');
    expect(migrateTab('search')).toBe('search');
    expect(migrateTab('changes')).toBe('changes');
    expect(migrateTab('stats')).toBe('stats');
    expect(migrateTab('activity')).toBe('activity');
    expect(migrateTab('todos')).toBe('todos');
  });

  it("falls back to 'sessions' for unknown values", () => {
    expect(migrateTab('garbage')).toBe('sessions');
    expect(migrateTab('')).toBe('sessions');
    expect(migrateTab('dashboard')).toBe('sessions');
    expect(migrateTab('commits')).toBe('sessions');
    expect(migrateTab('tokens')).toBe('sessions');
  });
});

describe('restore: legacy stats-dashboard tile migration', () => {
  it('strips a lone stats-dashboard:main leaf from the persisted tree', async () => {
    (window as any).mcode.layout.load.mockResolvedValueOnce({
      mosaicTree: 'stats-dashboard:main',
      sidebarWidth: 280,
      sidebarCollapsed: false,
      activeSidebarTab: 'sessions',
      terminalPanelState: null,
    });
    await useLayoutStore.getState().restore();
    expect(useLayoutStore.getState().mosaicTree).toBeNull();
  });

  it('strips stats-dashboard:main from a mixed split and redistributes the remaining children', async () => {
    (window as any).mcode.layout.load.mockResolvedValueOnce({
      mosaicTree: {
        type: 'split',
        direction: 'row',
        children: ['session:s1', 'stats-dashboard:main'],
        splitPercentages: [60, 40],
      },
      sidebarWidth: 280,
      sidebarCollapsed: false,
      activeSidebarTab: 'sessions',
      terminalPanelState: null,
    });
    await useLayoutStore.getState().restore();
    expect(useLayoutStore.getState().mosaicTree).toBe('session:s1');
  });

  it('leaves trees without the legacy tile unchanged', async () => {
    const tree = {
      type: 'split' as const,
      direction: 'row' as const,
      children: ['session:a', 'session:b'],
      splitPercentages: [50, 50],
    };
    (window as any).mcode.layout.load.mockResolvedValueOnce({
      mosaicTree: tree,
      sidebarWidth: 280,
      sidebarCollapsed: false,
      activeSidebarTab: 'sessions',
      terminalPanelState: null,
    });
    await useLayoutStore.getState().restore();
    expect(useLayoutStore.getState().mosaicTree).toEqual(tree);
  });
});
