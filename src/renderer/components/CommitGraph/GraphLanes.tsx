import type { CommitGraphRow } from '../../utils/lane-algorithm';

const LANE_WIDTH = 16;
const ROW_HEIGHT = 24;
const NODE_RADIUS = 4;
const LINE_WIDTH = 1.5;

interface GraphLanesProps {
  rows: CommitGraphRow[];
  maxColumn: number;
}

/**
 * SVG renderer for the graph lane lines and commit nodes.
 *
 * Renders the left-side graph portion:
 * - Vertical lane lines for active branches
 * - Curved connectors for merges/forks
 * - Circle nodes at each commit
 */
function GraphLanes({ rows, maxColumn }: GraphLanesProps): React.JSX.Element {
  const width = (maxColumn + 1) * LANE_WIDTH + NODE_RADIUS * 2;
  const height = rows.length * ROW_HEIGHT;

  const cx = (col: number): number => col * LANE_WIDTH + LANE_WIDTH / 2;
  const cy = (row: number): number => row * ROW_HEIGHT + ROW_HEIGHT / 2;

  const paths: React.JSX.Element[] = [];
  const circles: React.JSX.Element[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nodeCx = cx(row.column);
    const nodeCy = cy(i);

    // Draw active lane lines (vertical segments through this row)
    for (const lane of row.activeLanes) {
      const lx = cx(lane.column);
      paths.push(
        <line
          key={`lane-${i}-${lane.column}`}
          x1={lx}
          y1={nodeCy - ROW_HEIGHT / 2}
          x2={lx}
          y2={nodeCy + ROW_HEIGHT / 2}
          stroke={lane.color}
          strokeWidth={LINE_WIDTH}
          opacity={0.5}
        />,
      );
    }

    // Draw connections to parents
    for (let c = 0; c < row.connections.length; c++) {
      const conn = row.connections[c];
      const fromX = cx(conn.fromColumn);
      const fromY = nodeCy;
      const toX = cx(conn.toColumn);
      const toY = cy(conn.toRow);

      if (conn.fromColumn === conn.toColumn) {
        // Straight vertical line
        paths.push(
          <line
            key={`conn-${i}-${c}`}
            x1={fromX}
            y1={fromY}
            x2={toX}
            y2={toY}
            stroke={conn.color}
            strokeWidth={LINE_WIDTH}
          />,
        );
      } else {
        // Curved connector for merge/fork
        const midY = fromY + ROW_HEIGHT * 0.6;
        paths.push(
          <path
            key={`conn-${i}-${c}`}
            d={`M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${fromY + ROW_HEIGHT}`}
            stroke={conn.color}
            strokeWidth={LINE_WIDTH}
            fill="none"
          />,
        );
        // Continue straight down from the curve end to the parent
        if (conn.toRow > i + 1) {
          paths.push(
            <line
              key={`conn-ext-${i}-${c}`}
              x1={toX}
              y1={fromY + ROW_HEIGHT}
              x2={toX}
              y2={toY}
              stroke={conn.color}
              strokeWidth={LINE_WIDTH}
            />,
          );
        }
      }
    }

    // Draw commit node
    circles.push(
      <circle
        key={`node-${i}`}
        cx={nodeCx}
        cy={nodeCy}
        r={NODE_RADIUS}
        fill={row.color}
        stroke="var(--color-bg-primary)"
        strokeWidth={1.5}
      />,
    );
  }

  return (
    <svg
      width={width}
      height={height}
      className="shrink-0"
      style={{ minWidth: width }}
    >
      {paths}
      {circles}
    </svg>
  );
}

export default GraphLanes;
export { LANE_WIDTH, ROW_HEIGHT };
