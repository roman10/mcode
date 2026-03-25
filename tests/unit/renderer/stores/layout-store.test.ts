import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLeaves } from 'react-mosaic-component';
import type { MosaicNode } from 'react-mosaic-component';

// Mock window.mcode before importing the store
vi.stubGlobal('window', {
  mcode: {
    layout: { save: vi.fn().mockResolvedValue(undefined), load: vi.fn().mockResolvedValue(null) },
    preferences: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
  },
});

const { useLayoutStore, sessionIdFromTileId, migrateTab } = await import(
  '../../../../src/renderer/stores/layout-store'
);

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
      restoreTree: null,
      pendingFileLine: null,
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

    it('restores remaining tiles when removing a maximized tile', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      useLayoutStore.getState().addTile('s3');

      useLayoutStore.getState().maximize('s2');
      // mosaicTree is now 'session:s2', restoreTree has {s1, s2, s3}

      useLayoutStore.getState().removeTile('s2');

      // Should restore remaining tiles, not show "No sessions"
      expect(getTree()).not.toBeNull();
      expect(countTiles()).toBe(2);
      expect(getLeafIds()).toContain('session:s1');
      expect(getLeafIds()).toContain('session:s3');
      expect(useLayoutStore.getState().restoreTree).toBeNull();
    });

    it('sets tree to null when removing maximized tile that is the only session', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().maximize('s1');
      useLayoutStore.getState().removeTile('s1');

      expect(getTree()).toBeNull();
      expect(useLayoutStore.getState().restoreTree).toBeNull();
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
    it('replaces tree with single tile and saves restore point', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      const beforeTree = getTree();

      useLayoutStore.getState().maximize('s1');

      expect(getTree()).toBe('session:s1');
      expect(useLayoutStore.getState().restoreTree).toEqual(beforeTree);
    });

    it('restores previous tree', () => {
      useLayoutStore.getState().addTile('s1');
      useLayoutStore.getState().addTile('s2');
      const beforeTree = getTree();

      useLayoutStore.getState().maximize('s1');
      useLayoutStore.getState().restoreFromMaximize();

      expect(getTree()).toEqual(beforeTree);
      expect(useLayoutStore.getState().restoreTree).toBeNull();
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

describe('migrateTab', () => {
  it("maps 'commits' to 'stats'", () => {
    expect(migrateTab('commits')).toBe('stats');
  });

  it("maps 'tokens' to 'stats'", () => {
    expect(migrateTab('tokens')).toBe('stats');
  });

  it('passes valid tabs through unchanged', () => {
    expect(migrateTab('sessions')).toBe('sessions');
    expect(migrateTab('search')).toBe('search');
    expect(migrateTab('changes')).toBe('changes');
    expect(migrateTab('stats')).toBe('stats');
    expect(migrateTab('activity')).toBe('activity');
  });

  it("falls back to 'sessions' for unknown values", () => {
    expect(migrateTab('garbage')).toBe('sessions');
    expect(migrateTab('')).toBe('sessions');
    expect(migrateTab('dashboard')).toBe('sessions');
  });
});
