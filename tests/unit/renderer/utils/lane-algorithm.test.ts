import { describe, it, expect } from 'vitest';
import { computeLanes, getMaxColumn } from '../../../../src/renderer/utils/lane-algorithm';
import { makeCommitNode } from '../../test-factories';

describe('computeLanes', () => {
  it('returns empty for no commits', () => {
    expect(computeLanes([])).toEqual([]);
  });

  it('assigns single commit to column 0', () => {
    const commits = [makeCommitNode({ hash: 'a', parents: [] })];
    const rows = computeLanes(commits);
    expect(rows).toHaveLength(1);
    expect(rows[0].column).toBe(0);
    expect(rows[0].connections).toEqual([]);
  });

  it('handles linear history (single lane)', () => {
    const commits = [
      makeCommitNode({ hash: 'c', parents: ['b'] }),
      makeCommitNode({ hash: 'b', parents: ['a'] }),
      makeCommitNode({ hash: 'a', parents: [] }),
    ];
    const rows = computeLanes(commits);

    // All in column 0
    expect(rows.every((r) => r.column === 0)).toBe(true);

    // First parent inherits color — all same color
    const colors = new Set(rows.map((r) => r.color));
    expect(colors.size).toBe(1);

    // Connections: c→b and b→a
    expect(rows[0].connections).toHaveLength(1);
    expect(rows[0].connections[0].toRow).toBe(1);
    expect(rows[1].connections).toHaveLength(1);
    expect(rows[1].connections[0].toRow).toBe(2);
  });

  it('handles a simple branch and merge', () => {
    // Topology: d merges b and c; b and c both parent a
    //   d (merge of b, c)
    //   b (parent: a)
    //   c (parent: a)
    //   a (root)
    const commits = [
      makeCommitNode({ hash: 'd', parents: ['b', 'c'] }),
      makeCommitNode({ hash: 'b', parents: ['a'] }),
      makeCommitNode({ hash: 'c', parents: ['a'] }),
      makeCommitNode({ hash: 'a', parents: [] }),
    ];
    const rows = computeLanes(commits);

    // d has two connections (to b and c)
    expect(rows[0].connections).toHaveLength(2);

    // b and c should be in different columns since d is a merge commit
    // The merge parent (c) gets a new lane
    const dConns = rows[0].connections;
    const cols = dConns.map((c) => c.toColumn);
    expect(cols[0]).not.toBe(cols[1]);
  });

  it('respects MAX_LANES cap (4)', () => {
    // Create commits that would need many lanes
    const commits = [
      makeCommitNode({ hash: 'merge', parents: ['p1', 'p2', 'p3', 'p4', 'p5'] }),
      makeCommitNode({ hash: 'p1', parents: [] }),
      makeCommitNode({ hash: 'p2', parents: [] }),
      makeCommitNode({ hash: 'p3', parents: [] }),
      makeCommitNode({ hash: 'p4', parents: [] }),
      makeCommitNode({ hash: 'p5', parents: [] }),
    ];
    const rows = computeLanes(commits);

    // No column should exceed MAX_LANES - 1 = 3
    for (const row of rows) {
      expect(row.column).toBeLessThanOrEqual(3);
    }
  });

  it('tracks active lanes at each row', () => {
    const commits = [
      makeCommitNode({ hash: 'c', parents: ['b'] }),
      makeCommitNode({ hash: 'b', parents: ['a'] }),
      makeCommitNode({ hash: 'a', parents: [] }),
    ];
    const rows = computeLanes(commits);

    // Row 0 (c): after rendering, lane 0 tracks 'b' → 1 active lane
    expect(rows[0].activeLanes.length).toBeGreaterThanOrEqual(1);
    // Row 2 (a): root commit, no parents → 0 active lanes
    expect(rows[2].activeLanes).toHaveLength(0);
  });

  it('assigns different colors to branch parents', () => {
    const commits = [
      makeCommitNode({ hash: 'merge', parents: ['main', 'feature'] }),
      makeCommitNode({ hash: 'main', parents: [] }),
      makeCommitNode({ hash: 'feature', parents: [] }),
    ];
    const rows = computeLanes(commits);

    // First parent (main) inherits merge color; second (feature) gets new color
    const mainConn = rows[0].connections.find((c) => c.toRow === 1)!;
    const featureConn = rows[0].connections.find((c) => c.toRow === 2)!;
    expect(mainConn.color).not.toBe(featureConn.color);
  });

  it('skips parents not in the visible range', () => {
    // Parent 'hidden' is not in our commit list
    const commits = [makeCommitNode({ hash: 'a', parents: ['hidden'] })];
    const rows = computeLanes(commits);
    expect(rows[0].connections).toHaveLength(0);
  });
});

describe('getMaxColumn', () => {
  it('returns 0 for empty rows', () => {
    expect(getMaxColumn([])).toBe(0);
  });

  it('returns max from columns, active lanes, and connections', () => {
    const commits = [
      makeCommitNode({ hash: 'merge', parents: ['a', 'b'] }),
      makeCommitNode({ hash: 'a', parents: [] }),
      makeCommitNode({ hash: 'b', parents: [] }),
    ];
    const rows = computeLanes(commits);
    const max = getMaxColumn(rows);
    expect(max).toBeGreaterThanOrEqual(1);
  });
});
