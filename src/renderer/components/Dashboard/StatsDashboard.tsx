import { useEffect, useState, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import HeatmapGrid from '../shared/HeatmapGrid';
import MonthlyBarChart, { type MonthlyEntry } from '../shared/MonthlyBarChart';
import Tooltip from '../shared/Tooltip';
import { todayStr, shiftDate, daysDiff, formatDateLabel } from '../../utils/date-nav';
import { AGENT_SESSION_TYPES, getAgentDefinition } from '@shared/session-agents';
import type { AgentSessionType } from '@shared/session-agents';
import type {
  TokenHeatmapEntry,
  CommitHeatmapEntry,
  CommitStreakInfo,
  InputHeatmapEntry,
} from '@shared/types';

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

type RangePreset = '90d' | '6m' | '1y' | 'all';

const RANGE_LABELS: Record<RangePreset, string> = {
  '90d': '90 days',
  '6m': '6 months',
  '1y': '1 year',
  'all': 'All time',
};

const RANGE_DAYS: Record<Exclude<RangePreset, 'all'>, number> = {
  '90d': 90,
  '6m': 183,
  '1y': 365,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCost(usd: number): string {
  if (usd < 0.01) return '< $0.01';
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function commitLevel(entry: CommitHeatmapEntry): number {
  if (entry.count >= 10) return 4;
  if (entry.count >= 6) return 3;
  if (entry.count >= 3) return 2;
  if (entry.count > 0) return 1;
  return 0;
}

function commitTooltip(entry: CommitHeatmapEntry): string {
  return `${entry.date}: ${entry.count} commit${entry.count !== 1 ? 's' : ''}`;
}

function tokenLevel(entry: TokenHeatmapEntry): number {
  if (entry.estimatedCostUsd >= 10) return 4;
  if (entry.estimatedCostUsd >= 5) return 3;
  if (entry.estimatedCostUsd >= 1) return 2;
  if (entry.estimatedCostUsd > 0) return 1;
  return 0;
}

function tokenTooltip(entry: TokenHeatmapEntry): string {
  return `${entry.date}: ${formatCost(entry.estimatedCostUsd)} · ${entry.messageCount} msgs`;
}

function inputLevel(entry: InputHeatmapEntry): number {
  if (entry.messageCount >= 200) return 4;
  if (entry.messageCount >= 100) return 3;
  if (entry.messageCount >= 30) return 2;
  if (entry.messageCount > 0) return 1;
  return 0;
}

function inputTooltip(entry: InputHeatmapEntry): string {
  return `${entry.date}: ${entry.messageCount} msg${entry.messageCount !== 1 ? 's' : ''} · ${formatNumber(entry.totalCharacters)} chars`;
}

function partitionByYear<T extends { date: string }>(entries: T[]): Array<{ year: string; entries: T[] }> {
  const groups = new Map<string, T[]>();
  for (const e of entries) {
    const year = e.date.slice(0, 4);
    const existing = groups.get(year);
    if (existing) existing.push(e);
    else groups.set(year, [e]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, es]) => ({ year, entries: es }));
}

function aggregateMonthly<T extends { date: string }>(entries: T[], getValue: (e: T) => number): MonthlyEntry[] {
  const sums = new Map<string, number>();
  for (const e of entries) {
    const month = e.date.slice(0, 7);
    sums.set(month, (sums.get(month) ?? 0) + getValue(e));
  }
  return Array.from(sums.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, value }));
}

function rangeBounds(preset: RangePreset): { start: string; end: string; fillEmpty: boolean } {
  const end = todayStr();
  if (preset === 'all') {
    return { start: '2000-01-01', end, fillEmpty: false };
  }
  const start = shiftDate(end, -(RANGE_DAYS[preset] - 1));
  return { start, end, fillEmpty: true };
}

// ─── Section: stacked-by-year heatmap or single heatmap ───────────────────────

interface YearHeatmapsProps<T extends { date: string }> {
  entries: T[];
  getLevel: (e: T) => number;
  getTooltip: (e: T) => string;
  selectedDate: string;
  onSelect: (date: string) => void;
  colorScale?: 'green' | 'emerald' | 'blue';
  spanYears: boolean;
}

function HeatmapSection<T extends { date: string }>({
  entries,
  getLevel,
  getTooltip,
  selectedDate,
  onSelect,
  colorScale,
  spanYears,
}: YearHeatmapsProps<T>): React.JSX.Element {
  if (entries.length === 0) return <></>;
  if (!spanYears) {
    return (
      <HeatmapGrid
        entries={entries}
        getLevel={getLevel}
        getTooltip={getTooltip}
        selectedDate={selectedDate}
        onSelect={onSelect}
        colorScale={colorScale}
      />
    );
  }
  const groups = partitionByYear(entries);
  return (
    <div className="space-y-3">
      {groups.map(({ year, entries: yearEntries }) => (
        <div key={year} className="space-y-1">
          <div className="text-xs text-text-muted font-medium">{year}</div>
          <HeatmapGrid
            entries={yearEntries}
            getLevel={getLevel}
            getTooltip={getTooltip}
            selectedDate={selectedDate}
            onSelect={onSelect}
            colorScale={colorScale}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface StatsDashboardProps {
  onClose?: () => void;
}

function StatsDashboard({ onClose }: StatsDashboardProps): React.JSX.Element {
  const [range, setRange] = useState<RangePreset>('1y');
  const [providerFilter, setProviderFilter] = useState<AgentSessionType | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [prefsRestored, setPrefsRestored] = useState(false);

  const [tokenHeatmap, setTokenHeatmap] = useState<TokenHeatmapEntry[]>([]);
  const [commitHeatmap, setCommitHeatmap] = useState<CommitHeatmapEntry[]>([]);
  const [inputHeatmap, setInputHeatmap] = useState<InputHeatmapEntry[]>([]);
  const [streaks, setStreaks] = useState<CommitStreakInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Restore persisted preferences
  useEffect(() => {
    Promise.all([
      window.mcode.preferences.get('statsDashboardRange'),
      window.mcode.preferences.get('statsDashboardProviderFilter'),
    ]).then(([rangeRaw, providerRaw]) => {
      if (rangeRaw === '90d' || rangeRaw === '6m' || rangeRaw === '1y' || rangeRaw === 'all') {
        setRange(rangeRaw);
      }
      if (providerRaw && AGENT_SESSION_TYPES.includes(providerRaw as AgentSessionType)) {
        setProviderFilter(providerRaw as AgentSessionType);
      }
      setPrefsRestored(true);
    }).catch(() => setPrefsRestored(true));
  }, []);

  // Persist range
  useEffect(() => {
    if (!prefsRestored) return;
    window.mcode.preferences.set('statsDashboardRange', range).catch(() => {});
  }, [range, prefsRestored]);

  // Persist provider filter
  useEffect(() => {
    if (!prefsRestored) return;
    window.mcode.preferences.set('statsDashboardProviderFilter', providerFilter ?? '').catch(() => {});
  }, [providerFilter, prefsRestored]);

  const loadData = useCallback(async (): Promise<void> => {
    const { start, end, fillEmpty } = rangeBounds(range);
    const provider = providerFilter ?? undefined;
    setLoading(true);
    try {
      const [tokens, commits, inputs, streakInfo] = await Promise.all([
        window.mcode.tokens.getHeatmap(start, end, provider, fillEmpty),
        window.mcode.commits.getHeatmap(start, end, provider, fillEmpty),
        window.mcode.input.getHeatmap(start, end, provider, fillEmpty),
        window.mcode.commits.getStreaks(provider),
      ]);
      setTokenHeatmap(tokens);
      setCommitHeatmap(commits);
      setInputHeatmap(inputs);
      setStreaks(streakInfo);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [range, providerFilter]);

  useEffect(() => {
    if (!prefsRestored) return;
    loadData();
  }, [prefsRestored, loadData]);

  const handleRefresh = useCallback((): void => {
    Promise.all([
      window.mcode.tokens.refresh(),
      window.mcode.commits.refresh(),
    ]).then(() => loadData()).catch(console.error);
  }, [loadData]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'r' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        handleRefresh();
      }
    },
    [handleRefresh],
  );

  // Range bounds for navigation
  const today = todayStr();
  const oldestSeen = useMemo(() => {
    const candidates = [tokenHeatmap[0]?.date, commitHeatmap[0]?.date, inputHeatmap[0]?.date].filter(Boolean) as string[];
    // No data → don't let the pager walk into a void (especially `'all'` whose start is '2000-01-01').
    if (candidates.length === 0) return today;
    return candidates.sort()[0];
  }, [tokenHeatmap, commitHeatmap, inputHeatmap, today]);

  const viewDate = selectedDate ?? today;
  const isToday = selectedDate == null;
  const canGoBack = daysDiff(oldestSeen, viewDate) > 0;

  const handlePrevDay = (): void => {
    const prev = shiftDate(viewDate, -1);
    if (daysDiff(oldestSeen, prev) >= 0) setSelectedDate(prev);
  };
  const handleNextDay = (): void => {
    if (isToday) return;
    const next = shiftDate(viewDate, 1);
    setSelectedDate(next >= today ? null : next);
  };

  const spanYears = range === 'all' || range === '1y'
    ? (oldestSeen.slice(0, 4) !== today.slice(0, 4))
    : false;
  const showMonthlyBars = range !== '90d';

  // Aggregate lifetime totals across the loaded range
  const totals = useMemo(() => {
    let totalCommits = 0;
    let totalInsertions = 0;
    for (const e of commitHeatmap) {
      totalCommits += e.count;
      totalInsertions += e.insertions;
    }
    let totalCost = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalMsgs = 0;
    for (const e of tokenHeatmap) {
      totalCost += e.estimatedCostUsd;
      totalTokensIn += e.inputTokens;
      totalTokensOut += e.outputTokens;
      totalMsgs += e.messageCount;
    }
    let totalHumanMsgs = 0;
    let totalChars = 0;
    for (const e of inputHeatmap) {
      totalHumanMsgs += e.messageCount;
      totalChars += e.totalCharacters;
    }
    return { totalCommits, totalInsertions, totalCost, totalTokensIn, totalTokensOut, totalMsgs, totalHumanMsgs, totalChars };
  }, [tokenHeatmap, commitHeatmap, inputHeatmap]);

  // Selected-day quick lookup. Built once per data refresh — find() per render
  // would scan thousands of rows on All-time ranges.
  const selectedCommit = useMemo(
    () => commitHeatmap.find((e) => e.date === viewDate),
    [commitHeatmap, viewDate],
  );
  const selectedToken = useMemo(
    () => tokenHeatmap.find((e) => e.date === viewDate),
    [tokenHeatmap, viewDate],
  );
  const selectedInput = useMemo(
    () => inputHeatmap.find((e) => e.date === viewDate),
    [inputHeatmap, viewDate],
  );

  const monthlyCommits = useMemo(() => aggregateMonthly(commitHeatmap, (e) => e.count), [commitHeatmap]);
  const monthlyCost = useMemo(() => aggregateMonthly(tokenHeatmap, (e) => e.estimatedCostUsd), [tokenHeatmap]);
  const monthlyInputMsgs = useMemo(() => aggregateMonthly(inputHeatmap, (e) => e.messageCount), [inputHeatmap]);

  const allEmpty = tokenHeatmap.length === 0 && commitHeatmap.length === 0 && inputHeatmap.length === 0;
  const hasAnyValue = totals.totalCommits + totals.totalCost + totals.totalHumanMsgs > 0;

  const dateRangeLabel = hasAnyValue ? `${formatDateLabel(oldestSeen)} – today` : null;

  return (
    <div
      className="flex flex-col h-full w-full bg-bg-primary outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-text-primary">Stats Dashboard</span>
          {dateRangeLabel && <span className="text-xs text-text-muted">{dateRangeLabel}</span>}
        </div>
        <div className="flex items-center gap-2">
          {/* Range presets */}
          <div className="flex items-center rounded border border-border-default overflow-hidden">
            {(Object.keys(RANGE_LABELS) as RangePreset[]).map((p) => (
              <button
                key={p}
                className={`text-xs px-2 py-0.5 transition-colors ${
                  range === p
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                }`}
                onClick={() => setRange(p)}
              >
                {RANGE_LABELS[p]}
              </button>
            ))}
          </div>

          <Tooltip content="Filter by CLI" side="bottom">
            <select
              className="text-xs px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary border border-border-default cursor-pointer outline-none hover:text-text-primary transition-colors"
              value={providerFilter ?? ''}
              onChange={(e) => setProviderFilter((e.target.value || null) as AgentSessionType | null)}
            >
              <option value="">All</option>
              {AGENT_SESSION_TYPES
                .filter((t) => getAgentDefinition(t)?.supportsTokenTracking || getAgentDefinition(t)?.supportsInputTracking)
                .map((t) => (
                  <option key={t} value={t}>{getAgentDefinition(t)!.displayName}</option>
                ))}
            </select>
          </Tooltip>

          {/* Day pager */}
          <div className="flex items-center gap-0.5">
            <Tooltip content="Previous day" side="bottom">
              <button
                className={`w-6 h-6 flex items-center justify-center rounded ${canGoBack ? 'text-text-muted hover:text-text-secondary hover:bg-bg-elevated cursor-pointer' : 'text-text-muted/30 cursor-default'}`}
                onClick={canGoBack ? handlePrevDay : undefined}
                aria-disabled={!canGoBack}
              >
                <ChevronLeft size={14} strokeWidth={2} />
              </button>
            </Tooltip>
            <button
              className="text-xs px-1.5 py-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors min-w-[60px] text-center"
              onClick={() => setSelectedDate(null)}
              title="Go to today"
            >
              {isToday ? 'Today' : formatDateLabel(viewDate)}
            </button>
            <Tooltip content="Next day" side="bottom">
              <button
                className={`w-6 h-6 flex items-center justify-center rounded ${isToday ? 'text-text-muted/30 cursor-default' : 'text-text-muted hover:text-text-secondary hover:bg-bg-elevated cursor-pointer'}`}
                onClick={isToday ? undefined : handleNextDay}
                aria-disabled={isToday}
              >
                <ChevronRight size={14} strokeWidth={2} />
              </button>
            </Tooltip>
          </div>

          <Tooltip content="Refresh (⌘R)" side="bottom">
            <button
              className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors cursor-pointer"
              onClick={handleRefresh}
            >
              <RefreshCw size={14} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
            </button>
          </Tooltip>

          {onClose && (
            <Tooltip content="Close (Esc)" side="bottom">
              <button
                className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors cursor-pointer"
                onClick={onClose}
              >
                <X size={14} strokeWidth={2} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {loading && allEmpty ? (
        <div className="flex items-center justify-center h-full text-text-muted text-sm">Loading...</div>
      ) : !hasAnyValue ? (
        <div className="flex items-center justify-center h-full text-text-muted text-sm">
          {range === 'all' ? 'No usage data tracked yet.' : `No activity in the last ${RANGE_LABELS[range].toLowerCase()}.`}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8 max-w-[1400px] mx-auto w-full">
          {/* Lifetime totals strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
            <SummaryStat label="Commits" value={formatNumber(totals.totalCommits)} sub={`${formatNumber(totals.totalInsertions)} insertions`} />
            <SummaryStat label="Cost" value={formatCost(totals.totalCost)} sub={`${formatNumber(totals.totalMsgs)} msgs`} />
            <SummaryStat label="Tokens" value={formatTokens(totals.totalTokensIn + totals.totalTokensOut)} sub={`${formatTokens(totals.totalTokensOut)} out`} />
            <SummaryStat label="Prompts" value={formatNumber(totals.totalHumanMsgs)} sub={`${formatNumber(totals.totalChars)} chars`} />
            <SummaryStat label="Current streak" value={streaks ? `${streaks.current}d` : '—'} sub="commit days" />
            <SummaryStat label="Longest streak" value={streaks ? `${streaks.longest}d` : '—'} sub="all time" />
          </div>

          {/* Selected day quick summary */}
          {!isToday && (
            <div className="text-xs text-text-secondary border-l-2 border-accent/40 pl-3 py-1">
              <span className="text-text-primary font-medium">{formatDateLabel(viewDate)}:</span>{' '}
              {selectedCommit?.count ?? 0} commit{selectedCommit?.count !== 1 ? 's' : ''} ·{' '}
              {formatCost(selectedToken?.estimatedCostUsd ?? 0)} ·{' '}
              {selectedToken?.messageCount ?? 0} agent msg{selectedToken?.messageCount !== 1 ? 's' : ''} ·{' '}
              {selectedInput?.messageCount ?? 0} prompt{selectedInput?.messageCount !== 1 ? 's' : ''}
            </div>
          )}

          {/* Output (commits) */}
          <DashboardSection
            title="Output — Commits"
            heatmap={
              <HeatmapSection
                entries={commitHeatmap}
                getLevel={commitLevel}
                getTooltip={commitTooltip}
                selectedDate={viewDate}
                onSelect={(d) => setSelectedDate(d === today ? null : d)}
                colorScale="green"
                spanYears={spanYears}
              />
            }
            monthly={
              showMonthlyBars && monthlyCommits.length > 0 ? (
                <MonthlyBarChart
                  entries={monthlyCommits}
                  formatTooltipValue={(v) => `${formatNumber(v)} commits`}
                  colorScale="green"
                />
              ) : null
            }
          />

          {/* Cost (tokens) */}
          <DashboardSection
            title="Cost — AI Tokens"
            heatmap={
              <HeatmapSection
                entries={tokenHeatmap}
                getLevel={tokenLevel}
                getTooltip={tokenTooltip}
                selectedDate={viewDate}
                onSelect={(d) => setSelectedDate(d === today ? null : d)}
                colorScale="emerald"
                spanYears={spanYears}
              />
            }
            monthly={
              showMonthlyBars && monthlyCost.length > 0 ? (
                <MonthlyBarChart
                  entries={monthlyCost}
                  formatTooltipValue={(v) => formatCost(v)}
                  colorScale="amber"
                />
              ) : null
            }
          />

          {/* Input (human prompts) */}
          <DashboardSection
            title="Input — Human Prompts"
            heatmap={
              <HeatmapSection
                entries={inputHeatmap}
                getLevel={inputLevel}
                getTooltip={inputTooltip}
                selectedDate={viewDate}
                onSelect={(d) => setSelectedDate(d === today ? null : d)}
                colorScale="blue"
                spanYears={spanYears}
              />
            }
            monthly={
              showMonthlyBars && monthlyInputMsgs.length > 0 ? (
                <MonthlyBarChart
                  entries={monthlyInputMsgs}
                  formatTooltipValue={(v) => `${formatNumber(v)} prompts`}
                  colorScale="blue"
                />
              ) : null
            }
          />
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, sub }: { label: string; value: string; sub?: string }): React.JSX.Element {
  return (
    <div className="rounded border border-border-default bg-bg-elevated/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="text-xl font-semibold text-text-primary mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function DashboardSection({
  title,
  heatmap,
  monthly,
}: {
  title: string;
  heatmap: React.ReactNode;
  monthly: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wide text-text-muted font-medium">{title}</div>
      <div>{heatmap}</div>
      {monthly && (
        <div className="pt-2">
          <div className="text-[10px] text-text-muted mb-1 uppercase tracking-wide">Monthly</div>
          {monthly}
        </div>
      )}
    </div>
  );
}

export default StatsDashboard;
