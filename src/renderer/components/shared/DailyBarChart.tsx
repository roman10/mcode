import { todayStr, shiftDate } from '../../utils/date-nav';

const CHART_W = 600;
const BAR_AREA_H = 48;

const COLORS: Record<string, { bar: string; avg: string }> = {
  green:   { bar: '#4ade80', avg: '#86efac' },
  emerald: { bar: '#34d399', avg: '#6ee7b7' },
  blue:    { bar: '#60a5fa', avg: '#93c5fd' },
  amber:   { bar: '#fbbf24', avg: '#fcd34d' },
};

interface DailyBarChartProps<T extends { date: string }> {
  entries: T[];
  getValue: (entry: T) => number;
  getTooltip: (date: string, value: number) => string;
  colorScale?: 'green' | 'emerald' | 'blue' | 'amber';
  selectedDate: string;
  onSelect: (date: string) => void;
  days?: number;
}

function DailyBarChart<T extends { date: string }>({
  entries,
  getValue,
  getTooltip,
  colorScale = 'green',
  selectedDate,
  onSelect,
  days = 90,
}: DailyBarChartProps<T>): React.JSX.Element {
  const colors = COLORS[colorScale] ?? COLORS.green;

  const today = todayStr();
  const dateRange: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dateRange.push(shiftDate(today, -i));
  }

  const valueMap = new Map(entries.map(e => [e.date, getValue(e)]));
  const values = dateRange.map(d => valueMap.get(d) ?? 0);
  let maxVal = 1;
  for (const v of values) if (v > maxVal) maxVal = v;

  // 7-day trailing rolling average
  const rollingAvg = values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - 6), i + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });

  // 30-day average reference line y-position
  const last30 = values.slice(Math.max(0, values.length - 30));
  const a30 = last30.length > 0 ? last30.reduce((s, v) => s + v, 0) / last30.length : 0;
  const avg30Y = a30 > 0 ? BAR_AREA_H - (a30 / maxVal) * BAR_AREA_H : null;

  const step = CHART_W / days;
  const barW = Math.max(2, step - 1.0);

  const barLeft = (i: number): number => i * step;
  const barH = (v: number): number => (v / maxVal) * BAR_AREA_H;
  const barTop = (v: number): number => BAR_AREA_H - barH(v);
  const midX = (i: number): number => barLeft(i) + barW / 2;

  const avgPoints = rollingAvg
    .map((avg, i) => `${midX(i).toFixed(1)},${barTop(avg).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${BAR_AREA_H}`}
      width="100%"
      height={BAR_AREA_H}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      {/* 30-day average dashed reference line */}
      {avg30Y != null && (
        <line
          x1={0} y1={avg30Y} x2={CHART_W} y2={avg30Y}
          stroke="#6b7280" strokeOpacity={0.4} strokeDasharray="3 2" strokeWidth={0.8}
        />
      )}

      {/* Bars */}
      {dateRange.map((date, i) => {
        const v = values[i];
        const h = barH(v);
        const isSelected = date === selectedDate;
        const x = barLeft(i);
        return (
          <g key={date} onClick={() => onSelect(date)} style={{ cursor: 'pointer' }}>
            {/* Full-height transparent hit area */}
            <rect x={x} y={0} width={barW} height={BAR_AREA_H} fill="transparent" />
            {/* Bar */}
            {h > 0.5 && (
              <rect
                x={x}
                y={barTop(v)}
                width={barW}
                height={h}
                fill={colors.bar}
                fillOpacity={isSelected ? 1 : 0.35}
                rx={0.5}
              />
            )}
            {/* Selected date indicator at bottom (visible even for zero-value days) */}
            {isSelected && (
              <rect x={x} y={BAR_AREA_H - 2} width={barW} height={2} fill={colors.bar} fillOpacity={0.9} rx={0.5} />
            )}
            <title>{getTooltip(date, v)}</title>
          </g>
        );
      })}

      {/* 7-day rolling average line */}
      <polyline
        points={avgPoints}
        fill="none"
        stroke={colors.avg}
        strokeWidth={1}
        strokeOpacity={0.85}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default DailyBarChart;
