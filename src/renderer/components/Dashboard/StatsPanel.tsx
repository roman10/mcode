import { useEffect, useCallback, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useStatsStore } from '../../stores/stats-store';
import { useAccountsStore } from '../../stores/accounts-store';
import Tooltip from '../shared/Tooltip';
import { todayStr, shiftDate, formatDateLabel, daysDiff } from '../../utils/date-nav';
import OutputSection from './OutputSection';
import CostSection from './CostSection';
import InputSection from './InputSection';

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');
const RETENTION_DAYS = 90;

// ─── Main component ───────────────────────────────────────────────────────────

function StatsPanel(): React.JSX.Element {
  const {
    dailyUsage,
    tokenHeatmap,
    tokenWeeklyTrend,
    dailyStats,
    commitHeatmap,
    streaks,
    cadence,
    commitWeeklyTrend,
    dailyInputStats,
    inputHeatmap,
    inputWeeklyTrend,
    inputCadence,
    loading,
    refreshAll,
    selectedDate,
    setSelectedDate,
  } = useStatsStore();

  const { accounts, subscriptionByAccount, refreshSubscriptionUsage } = useAccountsStore();

  // Collapse state for sections
  const [outputCollapsed, setOutputCollapsed] = useState(false);
  const [costCollapsed, setCostCollapsed] = useState(false);
  const [inputCollapsed, setInputCollapsed] = useState(false);
  const [collapsedRestored, setCollapsedRestored] = useState(false);

  // Restore collapsed state from preferences on mount
  useEffect(() => {
    window.mcode.preferences.get('statsCollapsed').then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.output) setOutputCollapsed(true);
          if (parsed.cost) setCostCollapsed(true);
          if (parsed.input) setInputCollapsed(true);
        } catch { /* ignore malformed */ }
      }
      setCollapsedRestored(true);
    }).catch(() => setCollapsedRestored(true));
  }, []);

  // Persist whenever collapse state changes (skip the initial restore)
  useEffect(() => {
    if (!collapsedRestored) return;
    window.mcode.preferences.set(
      'statsCollapsed',
      JSON.stringify({ output: outputCollapsed, cost: costCollapsed, input: inputCollapsed }),
    ).catch(() => {});
  }, [outputCollapsed, costCollapsed, inputCollapsed, collapsedRestored]);

  // Load data on mount. Live-update subscriptions live in SidebarPanel (always mounted).
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Fetch subscription quotas once on mount — independent of date changes.
  useEffect(() => {
    refreshSubscriptionUsage().catch(console.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback((): void => {
    Promise.all([window.mcode.tokens.refresh(), window.mcode.commits.refresh()])
      .then(() => refreshAll())
      .catch(console.error);
    refreshSubscriptionUsage().catch(console.error);
  }, [refreshAll, refreshSubscriptionUsage]);

  const handleForceRefresh = useCallback((): void => {
    window.mcode.commits.forceRescan()
      .then(() => refreshAll())
      .catch(console.error);
  }, [refreshAll]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'r') {
        e.preventDefault();
        e.stopPropagation();
        handleRefresh();
      }
    },
    [handleRefresh],
  );

  const today = todayStr();
  const viewDate = selectedDate ?? today;
  const isToday = selectedDate == null;
  const oldest = shiftDate(today, -(RETENTION_DAYS - 1));
  const canGoBack = daysDiff(oldest, viewDate) > 0;

  const handleHeatmapSelect = (date: string): void => {
    setSelectedDate(date === today ? null : date);
  };

  const handlePrevDay = (): void => {
    const prev = shiftDate(viewDate, -1);
    if (daysDiff(oldest, prev) >= 0) setSelectedDate(prev);
  };

  const handleNextDay = (): void => {
    if (isToday) return;
    const next = shiftDate(viewDate, 1);
    setSelectedDate(next >= today ? null : next);
  };

  const btnClass =
    'w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors';
  const btnDisabledClass = 'w-5 h-5 flex items-center justify-center rounded text-text-muted/30 cursor-default';

  const toolbar = (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-default shrink-0">
      <span className="text-xs text-text-secondary uppercase tracking-wide">Stats</span>
      <div className="flex items-center gap-1">
        <Tooltip content="Previous day" side="bottom">
          <button
            className={canGoBack ? btnClass : btnDisabledClass}
            onClick={canGoBack ? handlePrevDay : undefined}
            aria-disabled={!canGoBack}
          >
            <ChevronLeft size={12} strokeWidth={2} />
          </button>
        </Tooltip>
        <button
          className="text-xs px-1.5 py-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors min-w-[48px] text-center"
          onClick={() => setSelectedDate(null)}
          title="Go to today"
        >
          {isToday ? 'Today' : formatDateLabel(viewDate)}
        </button>
        <Tooltip content="Next day" side="bottom">
          <button
            className={isToday ? btnDisabledClass : btnClass}
            onClick={isToday ? undefined : handleNextDay}
            aria-disabled={isToday}
          >
            <ChevronRight size={12} strokeWidth={2} />
          </button>
        </Tooltip>
        <Tooltip content="Refresh (⌘R, ⇧ for full 90-day backfill)" side="bottom">
          <button className={btnClass} onClick={(e) => e.shiftKey ? handleForceRefresh() : handleRefresh()}>
            <RefreshCw size={12} strokeWidth={2} />
          </button>
        </Tooltip>
      </div>
    </div>
  );

  if (loading && !dailyStats && !dailyUsage) {
    return (
      <div className="flex flex-col h-full w-full bg-bg-primary">
        {toolbar}
        <div className="flex items-center justify-center h-full text-text-muted text-sm">Loading...</div>
      </div>
    );
  }

  const dateLabel = isToday ? 'today' : `on ${formatDateLabel(viewDate)}`;

  return (
    <div className="flex flex-col h-full w-full bg-bg-primary outline-none" tabIndex={-1} onKeyDown={handleKeyDown}>
      {toolbar}

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        <OutputSection
          collapsed={outputCollapsed}
          onToggle={() => setOutputCollapsed((v) => !v)}
          dailyStats={dailyStats}
          commitHeatmap={commitHeatmap}
          streaks={streaks}
          cadence={cadence}
          commitWeeklyTrend={commitWeeklyTrend}
          viewDate={viewDate}
          onHeatmapSelect={handleHeatmapSelect}
          dateLabel={dateLabel}
        />

        <CostSection
          collapsed={costCollapsed}
          onToggle={() => setCostCollapsed((v) => !v)}
          dailyUsage={dailyUsage}
          tokenHeatmap={tokenHeatmap}
          tokenWeeklyTrend={tokenWeeklyTrend}
          accounts={accounts}
          subscriptionByAccount={subscriptionByAccount}
          viewDate={viewDate}
          onHeatmapSelect={handleHeatmapSelect}
          dateLabel={dateLabel}
        />

        <InputSection
          collapsed={inputCollapsed}
          onToggle={() => setInputCollapsed((v) => !v)}
          dailyInputStats={dailyInputStats}
          inputHeatmap={inputHeatmap}
          inputWeeklyTrend={inputWeeklyTrend}
          inputCadence={inputCadence}
          viewDate={viewDate}
          onHeatmapSelect={handleHeatmapSelect}
          dateLabel={dateLabel}
        />
      </div>
    </div>
  );
}

export default StatsPanel;
