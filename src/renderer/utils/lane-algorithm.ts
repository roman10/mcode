import type { CommitGraphNode } from '../../shared/types';

/** Visual connection between two rows in the graph. */
export interface LaneConnection {
  fromColumn: number;
  toColumn: number;
  /** Row index of the parent commit (target of the connection). */
  toRow: number;
  color: string;
}

/** Layout info for a single commit row. */
export interface CommitGraphRow {
  node: CommitGraphNode;
  column: number;
  color: string;
  connections: LaneConnection[];
  /** Active lane columns at this row (for drawing vertical lines). */
  activeLanes: { column: number; color: string }[];
}

const LANE_COLORS = [
  '#58a6ff', // blue (accent)
  '#3fb950', // green
  '#bc8cff', // purple
  '#f0883e', // orange
  '#f778ba', // pink
  '#79c0ff', // light blue
  '#d29922', // gold
];

const MAX_LANES = 4;

/**
 * Assign visual lanes (columns) to commits for graph rendering.
 *
 * Expects commits in topological order (newest first), which is how
 * `git log --topo-order` returns them.
 */
export function computeLanes(commits: CommitGraphNode[]): CommitGraphRow[] {
  if (commits.length === 0) return [];

  // Map hash → row index for quick parent lookups
  const hashToRow = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    hashToRow.set(commits[i].hash, i);
  }

  // Each "lane" is an active vertical line expecting a specific commit hash.
  // lanes[column] = hash the lane is tracking (or null if free).
  const lanes: (string | null)[] = [];
  const laneColors = new Map<string, string>(); // hash → color for the lane it occupies
  let nextColor = 0;

  const rows: CommitGraphRow[] = [];

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];

    // Find which lane this commit occupies (if any lane is expecting it).
    let column = lanes.indexOf(commit.hash);

    if (column === -1) {
      // New branch — find the first free lane.
      column = lanes.indexOf(null);
      if (column === -1) {
        column = Math.min(lanes.length, MAX_LANES - 1);
        if (column === lanes.length) lanes.push(null);
      }
    }

    // Assign color for this commit's lane
    if (!laneColors.has(commit.hash)) {
      laneColors.set(commit.hash, LANE_COLORS[nextColor % LANE_COLORS.length]);
      nextColor++;
    }
    const color = laneColors.get(commit.hash)!;

    // Clear the lane this commit was in (it's now rendered).
    lanes[column] = null;

    // Assign parents to lanes.
    const connections: LaneConnection[] = [];
    for (let p = 0; p < commit.parents.length; p++) {
      const parentHash = commit.parents[p];
      const parentRow = hashToRow.get(parentHash);
      if (parentRow === undefined) continue; // parent not in our visible range

      // Check if any lane is already tracking this parent
      let parentCol = lanes.indexOf(parentHash);

      if (parentCol === -1) {
        if (p === 0) {
          // First parent continues in the same lane
          parentCol = column;
        } else {
          // Additional parents (merge) — find a free lane
          parentCol = lanes.indexOf(null);
          if (parentCol === -1) {
            parentCol = Math.min(lanes.length, MAX_LANES - 1);
            if (parentCol === lanes.length) lanes.push(null);
          }
        }
        lanes[parentCol] = parentHash;

        // Assign color: first parent inherits, others get new color
        if (!laneColors.has(parentHash)) {
          if (p === 0) {
            laneColors.set(parentHash, color);
          } else {
            laneColors.set(parentHash, LANE_COLORS[nextColor % LANE_COLORS.length]);
            nextColor++;
          }
        }
      }

      connections.push({
        fromColumn: column,
        toColumn: parentCol,
        toRow: parentRow,
        color: laneColors.get(parentHash) ?? color,
      });
    }

    // Snapshot active lanes at this row
    const activeLanes: { column: number; color: string }[] = [];
    for (let l = 0; l < lanes.length; l++) {
      if (lanes[l] !== null) {
        activeLanes.push({ column: l, color: laneColors.get(lanes[l]!) ?? LANE_COLORS[0] });
      }
    }

    rows.push({
      node: commit,
      column,
      color,
      connections,
      activeLanes,
    });
  }

  // Trim unused trailing lanes
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
    lanes.pop();
  }

  return rows;
}

/** Get the maximum column index used across all rows. */
export function getMaxColumn(rows: CommitGraphRow[]): number {
  let max = 0;
  for (const row of rows) {
    max = Math.max(max, row.column);
    for (const lane of row.activeLanes) {
      max = Math.max(max, lane.column);
    }
    for (const conn of row.connections) {
      max = Math.max(max, conn.fromColumn, conn.toColumn);
    }
  }
  return max;
}
