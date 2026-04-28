import { useState, useCallback } from 'react';

const CHART_W = 600;
const BAR_AREA_H = 80;

const COLORS: Record<string, { bar: string }> = {
  green:   { bar: '#4ade80' },
  emerald: { bar: '#34d399' },
  blue:    { bar: '#60a5fa' },
  amber:   { bar: '#fbbf24' },
};

export interface MonthlyEntry {
  /** YYYY-MM */
  month: string;
  value: number;
}

interface MonthlyBarChartProps {
  entries: MonthlyEntry[];
  formatTooltipValue: (value: number) => string;
  colorScale?: 'green' | 'emerald' | 'blue' | 'amber';
}

function formatMonthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function MonthlyBarChart({
  entries,
  formatTooltipValue,
  colorScale = 'green',
}: MonthlyBarChartProps): React.JSX.Element {
  const colors = COLORS[colorScale] ?? COLORS.green;
  const [hovered, setHovered] = useState<{ index: number; x: number; y: number } | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGGElement>, index: number) => {
    setHovered({ index, x: e.clientX, y: e.clientY });
  }, []);
  const handleMouseLeave = useCallback(() => setHovered(null), []);

  if (entries.length === 0) return <></>;

  let maxVal = 1;
  for (const e of entries) if (e.value > maxVal) maxVal = e.value;

  const step = CHART_W / entries.length;
  const barW = Math.max(2, step - 2);
  const barLeft = (i: number): number => i * step + (step - barW) / 2;
  const barH = (v: number): number => (v / maxVal) * BAR_AREA_H;
  const barTop = (v: number): number => BAR_AREA_H - barH(v);

  // Pick which months to label (avoid overcrowding): aim for ≤12 labels
  const labelStride = Math.max(1, Math.ceil(entries.length / 12));

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${CHART_W} ${BAR_AREA_H}`}
        width="100%"
        height={BAR_AREA_H}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
        aria-hidden="true"
      >
        {entries.map((entry, i) => {
          const v = entry.value;
          const h = barH(v);
          const x = barLeft(i);
          return (
            <g
              key={entry.month}
              onMouseMove={(e) => handleMouseMove(e, i)}
              onMouseLeave={handleMouseLeave}
              style={{ cursor: 'pointer' }}
            >
              <rect x={i * step} y={0} width={step} height={BAR_AREA_H} fill="transparent" />
              {h > 0.5 && (
                <rect
                  x={x}
                  y={barTop(v)}
                  width={barW}
                  height={h}
                  fill={colors.bar}
                  fillOpacity={hovered?.index === i ? 1 : 0.6}
                  rx={1}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Labels live outside the stretched SVG so glyphs aren't distorted. */}
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

      {hovered && (
        <div
          className="fixed z-50 rounded px-2 py-1 text-xs bg-bg-elevated text-text-primary shadow-md border border-border-subtle pointer-events-none whitespace-nowrap"
          style={{
            left: hovered.x,
            top: hovered.y,
            transform: 'translate(-50%, -100%) translateY(-6px)',
          }}
        >
          <div>{formatMonthLabel(entries[hovered.index].month)}</div>
          <div className="text-text-secondary">{formatTooltipValue(entries[hovered.index].value)}</div>
        </div>
      )}
    </div>
  );
}

export default MonthlyBarChart;
