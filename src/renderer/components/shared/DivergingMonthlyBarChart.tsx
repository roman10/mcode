import { useState, useCallback } from 'react';

const CHART_W = 600;
const HALF_H = 40;
const CHART_H = HALF_H * 2;

const COLOR_INSERT = '#4ade80';
const COLOR_DELETE = '#f87171';

export interface DivergingMonthlyEntry {
  /** YYYY-MM */
  month: string;
  insertions: number;
  deletions: number;
}

interface DivergingMonthlyBarChartProps {
  entries: DivergingMonthlyEntry[];
  /** Formats the bare numeric magnitude for display (e.g. 1234 → "1.2K"). */
  formatValue: (value: number) => string;
  /** Unit appended after the net summary line. */
  unit?: string;
}

function formatMonthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function DivergingMonthlyBarChart({
  entries,
  formatValue,
  unit,
}: DivergingMonthlyBarChartProps): React.JSX.Element {
  const [hovered, setHovered] = useState<{ index: number; x: number; y: number } | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGGElement>, index: number) => {
    setHovered({ index, x: e.clientX, y: e.clientY });
  }, []);
  const handleMouseLeave = useCallback(() => setHovered(null), []);

  if (entries.length === 0) return <></>;

  // Shared scale across both halves so a +2K / −8K month visually reads net-negative.
  let maxVal = 1;
  for (const e of entries) {
    if (e.insertions > maxVal) maxVal = e.insertions;
    if (e.deletions > maxVal) maxVal = e.deletions;
  }

  const step = CHART_W / entries.length;
  const barW = Math.max(2, step - 2);
  const barLeft = (i: number): number => i * step + (step - barW) / 2;
  const halfH = (v: number): number => (v / maxVal) * HALF_H;

  const labelStride = Math.max(1, Math.ceil(entries.length / 12));

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        width="100%"
        height={CHART_H}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
        aria-hidden="true"
      >
        {/* Center baseline */}
        <line x1={0} x2={CHART_W} y1={HALF_H} y2={HALF_H} stroke="currentColor" strokeOpacity={0.15} strokeWidth={1} />

        {entries.map((entry, i) => {
          const insH = halfH(entry.insertions);
          const delH = halfH(entry.deletions);
          const x = barLeft(i);
          const isHovered = hovered?.index === i;
          return (
            <g
              key={entry.month}
              onMouseMove={(e) => handleMouseMove(e, i)}
              onMouseLeave={handleMouseLeave}
              style={{ cursor: 'pointer' }}
            >
              <rect x={i * step} y={0} width={step} height={CHART_H} fill="transparent" />
              {insH > 0.5 && (
                <rect
                  x={x}
                  y={HALF_H - insH}
                  width={barW}
                  height={insH}
                  fill={COLOR_INSERT}
                  fillOpacity={isHovered ? 1 : 0.6}
                  rx={1}
                />
              )}
              {delH > 0.5 && (
                <rect
                  x={x}
                  y={HALF_H}
                  width={barW}
                  height={delH}
                  fill={COLOR_DELETE}
                  fillOpacity={isHovered ? 1 : 0.6}
                  rx={1}
                />
              )}
            </g>
          );
        })}
      </svg>

      <div className="relative w-full text-text-muted" style={{ height: 14 }}>
        {entries.map((entry, i) =>
          i % labelStride === 0 ? (
            <span
              key={`l-${entry.month}`}
              className="absolute text-[9px] -translate-x-1/2 mt-0.5"
              style={{ left: `${((i + 0.5) / entries.length) * 100}%` }}
            >
              {formatMonthLabel(entry.month)}
            </span>
          ) : null,
        )}
      </div>

      {hovered && (() => {
        const e = entries[hovered.index];
        const net = e.insertions - e.deletions;
        const netLabel = net >= 0 ? `+${formatValue(net)}` : `−${formatValue(-net)}`;
        const unitSuffix = unit ? ` ${unit}` : '';
        return (
          <div
            className="fixed z-50 rounded px-2 py-1 text-xs bg-bg-elevated text-text-primary shadow-md border border-border-subtle pointer-events-none whitespace-nowrap"
            style={{
              left: hovered.x,
              top: hovered.y,
              transform: 'translate(-50%, -100%) translateY(-6px)',
            }}
          >
            <div>{formatMonthLabel(e.month)}</div>
            <div className="text-text-secondary">
              <span className="text-green-400">+{formatValue(e.insertions)}</span>
              {' / '}
              <span className="text-red-400">−{formatValue(e.deletions)}</span>
            </div>
            <div className="text-text-muted">net {netLabel}{unitSuffix}</div>
          </div>
        );
      })()}
    </div>
  );
}

export default DivergingMonthlyBarChart;
