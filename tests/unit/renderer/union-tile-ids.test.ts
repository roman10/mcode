import { describe, it, expect } from 'vitest';
import { createBalancedTreeFromLeaves, getLeaves } from 'react-mosaic-component';
import type { MosaicNode } from 'react-mosaic-component';
import { unionTileIds } from '../../../src/renderer/utils/tile-id';

// Build trees with the same react-mosaic helper the layout store uses.
// createBalancedTreeFromLeaves does NOT preserve input order for all leaf
// counts, so expectations are derived from getLeaves (the helper's actual
// contract: background leaves in getLeaves order, then overlay-only leaves
// in getLeaves order, de-duped).
const tree = (...leaves: string[]) => createBalancedTreeFromLeaves(leaves)!;

const expectedUnion = (
  bg: MosaicNode<string> | null,
  ov: MosaicNode<string> | null,
): string[] => {
  const b = bg ? getLeaves(bg) : [];
  const seen = new Set(b);
  return [...b, ...(ov ? getLeaves(ov) : []).filter((id) => !seen.has(id))];
};

describe('unionTileIds', () => {
  it('returns [] when both trees are null', () => {
    expect(unionTileIds(null, null)).toEqual([]);
  });

  it('returns exactly the background leaves when no overlay', () => {
    const bg = tree('session:a', 'session:b', 'session:c');
    expect(unionTileIds(bg, null)).toEqual(getLeaves(bg));
  });

  it('appends overlay-only leaves after background leaves, deduped', () => {
    const bg = tree('session:a', 'session:b');
    const ov = tree('session:a', 'session:z'); // z is overlay-only
    const result = unionTileIds(bg, ov);
    expect(result).toEqual(expectedUnion(bg, ov));
    expect(result).toContain('session:z');
    expect(result.filter((id) => id === 'session:a')).toHaveLength(1);
    // every background leaf precedes every overlay-only leaf
    expect(result.indexOf('session:z')).toBe(result.length - 1);
  });

  it('does not duplicate a leaf present in both trees', () => {
    const bg = tree('session:a', 'session:b');
    const ov = tree('session:b', 'session:a');
    expect(unionTileIds(bg, ov)).toEqual(getLeaves(bg));
  });

  it('handles a single-string (leaf) background tree', () => {
    expect(unionTileIds('session:a', tree('session:a', 'session:b'))).toEqual([
      'session:a',
      'session:b',
    ]);
  });

  it('returns the overlay leaves when background is null', () => {
    const ov = tree('file:/x', 'session:a');
    expect(unionTileIds(null, ov)).toEqual(getLeaves(ov));
  });

  it('is deterministic across repeated calls', () => {
    const bg = tree('session:a', 'session:b', 'session:c');
    const ov = tree('session:c', 'session:d');
    const once = unionTileIds(bg, ov);
    expect(unionTileIds(bg, ov)).toEqual(once);
    expect(once).toEqual(expectedUnion(bg, ov));
    expect(once).toContain('session:d');
  });
});
