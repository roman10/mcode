import { useMemo } from 'react';

const CELL_SIZE = 10;
const GAP = 2;
const STEP = CELL_SIZE + GAP;

const WEEKDAY_LABELS = ['M', '', 'W', '', 'F', '', ''];

const COLOR_SCALES: Record<string, string[]> = {
  green: ['bg-bg-elevated', 'bg-green-900', 'bg-green-700', 'bg-green-500', 'bg-green-400'],
  emerald: ['bg-bg-elevated', 'bg-emerald-900', 'bg-emerald-700', 'bg-emerald-500', 'bg-emerald-400'],
};

interface HeatmapGridProps<T extends { date: string }> {
  entries: T[];
  getLevel: (entry: T) => number;
  getTooltip: (entry: T) => string;
  selectedDate: string;
  onSelect: (date: string) => void;
  colorScale?: 'green' | 'emerald';
}

/** Convert JS Date.getDay() (0=Sun) to Monday-based index (0=Mon, 6=Sun). */
function mondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

interface MonthLabel {
  label: string;
  col: number;
  span: number;
}

function computeMonthLabels(entries: { date: string }[], leadingBlanks: number): MonthLabel[] {
  if (entries.length === 0) return [];

  const labels: MonthLabel[] = [];
  let currentMonth = '';

  for (let i = 0; i < entries.length; i++) {
    const month = entries[i].date.slice(0, 7); // YYYY-MM
    const col = Math.floor((leadingBlanks + i) / 7);
    if (month !== currentMonth) {
      if (labels.length > 0) {
        labels[labels.length - 1].span = col - labels[labels.length - 1].col;
      }
      const monthName = new Date(entries[i].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' });
      labels.push({ label: monthName, col, span: 1 });
      currentMonth = month;
    }
  }

  // Close last label
  if (labels.length > 0) {
    const totalCols = Math.ceil((leadingBlanks + entries.length) / 7);
    labels[labels.length - 1].span = totalCols - labels[labels.length - 1].col;
  }

  return labels;
}

function HeatmapGrid<T extends { date: string }>({
  entries,
  getLevel,
  getTooltip,
  selectedDate,
  onSelect,
  colorScale = 'green',
}: HeatmapGridProps<T>): React.JSX.Element {
  const colors = COLOR_SCALES[colorScale] ?? COLOR_SCALES.green;

  const { leadingBlanks, totalCols, monthLabels } = useMemo(() => {
    if (entries.length === 0) return { leadingBlanks: 0, totalCols: 0, monthLabels: [] };
    const firstDate = new Date(entries[0].date + 'T12:00:00');
    const blanks = mondayIndex(firstDate.getDay());
    const cols = Math.ceil((blanks + entries.length) / 7);
    const labels = computeMonthLabels(entries, blanks);
    return { leadingBlanks: blanks, totalCols: cols, monthLabels: labels };
  }, [entries]);

  if (entries.length === 0) return <></>;

  const labelWidth = 14;
  const gridWidth = totalCols * STEP - GAP;

  return (
    <div className="flex flex-col gap-1">
      {/* Month labels */}
      <div className="flex text-[9px] text-text-muted" style={{ marginLeft: labelWidth }}>
        {monthLabels.map((m) => (
          <span
            key={`${m.label}-${m.col}`}
            style={{ width: m.span * STEP }}
            className="truncate"
          >
            {m.span >= 2 ? m.label : ''}
          </span>
        ))}
      </div>

      {/* Grid with weekday labels */}
      <div className="flex">
        {/* Weekday labels */}
        <div
          className="grid shrink-0"
          style={{
            gridTemplateRows: `repeat(7, ${CELL_SIZE}px)`,
            gap: `${GAP}px`,
            width: labelWidth,
          }}
        >
          {WEEKDAY_LABELS.map((label, i) => (
            <span key={i} className="text-[9px] text-text-muted leading-none flex items-center">
              {label}
            </span>
          ))}
        </div>

        {/* Heatmap cells */}
        <div
          className="grid"
          style={{
            gridTemplateRows: `repeat(7, ${CELL_SIZE}px)`,
            gridAutoFlow: 'column',
            gridAutoColumns: `${CELL_SIZE}px`,
            gap: `${GAP}px`,
            width: gridWidth,
          }}
        >
          {/* Leading blanks for partial first week */}
          {Array.from({ length: leadingBlanks }, (_, i) => (
            <div key={`blank-${i}`} />
          ))}

          {/* Actual cells */}
          {entries.map((entry) => {
            const level = Math.max(0, Math.min(4, getLevel(entry)));
            const bg = colors[level];
            const isSelected = entry.date === selectedDate;
            return (
              <div
                key={entry.date}
                className={`rounded-[2px] cursor-pointer ${bg} ${isSelected ? 'ring-1 ring-white/40' : ''}`}
                style={{ width: CELL_SIZE, height: CELL_SIZE }}
                title={getTooltip(entry)}
                onClick={() => onSelect(entry.date)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default HeatmapGrid;
