import { useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useTokenStore } from '../../stores/token-store';
import { useAccountsStore } from '../../stores/accounts-store';
import Tooltip from '../shared/Tooltip';
import HeatmapGrid from '../shared/HeatmapGrid';
import { todayStr, shiftDate, formatDateLabel, daysDiff, formatTimeUntil } from '../../utils/date-nav';
import type { TokenHeatmapEntry, ModelUsageSummary, SubscriptionUsage } from '../../../shared/types';

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');
const RETENTION_DAYS = 90;

function formatCost(usd: number): string {
  if (usd < 0.01) return '< $0.01';
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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

const modelFamilyColors: Record<string, string> = {
  opus: 'bg-purple-900/80 text-purple-300',
  sonnet: 'bg-blue-900/80 text-blue-300',
  haiku: 'bg-green-900/80 text-green-300',
  unknown: 'bg-gray-700/80 text-gray-300',
};

function ModelPill({ model, totalCost }: { model: ModelUsageSummary; totalCost: number }): React.JSX.Element {
  const color = modelFamilyColors[model.modelFamily] ?? modelFamilyColors.unknown;
  const pct = totalCost > 0 ? (model.estimatedCostUsd / totalCost * 100).toFixed(0) : '0';

  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${color}`}>
      {model.model} {formatCost(model.estimatedCostUsd)} ({pct}%)
    </span>
  );
}

function UsageQuotaBar({ label, utilization, resetsAt }: { label: string; utilization: number; resetsAt: string | null }): React.JSX.Element {
  const pct = Math.min(100, Math.max(0, utilization));
  const fillColor = pct >= 95 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-blue-500';
  const timeStr = formatTimeUntil(resetsAt);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-text-muted w-12 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
        <div className={`h-full rounded-full ${fillColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-text-muted w-8 text-right shrink-0">{Math.round(pct)}%</span>
      {timeStr && <span className="text-text-muted/70 shrink-0">{timeStr}</span>}
    </div>
  );
}

function UsageQuotaSection({ usage, accountName }: { usage: SubscriptionUsage; accountName?: string }): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      {accountName && <div className="text-xs text-text-muted font-medium">{accountName}</div>}
      {usage.fiveHour && (
        <UsageQuotaBar label="5-hour" utilization={usage.fiveHour.utilization} resetsAt={usage.fiveHour.resetsAt} />
      )}
      {usage.sevenDay && (
        <UsageQuotaBar label="7-day" utilization={usage.sevenDay.utilization} resetsAt={usage.sevenDay.resetsAt} />
      )}
      {usage.sevenDayOpus && (
        <UsageQuotaBar label="Opus" utilization={usage.sevenDayOpus.utilization} resetsAt={usage.sevenDayOpus.resetsAt} />
      )}
    </div>
  );
}

function TokenStats(): React.JSX.Element {
  const { dailyUsage, heatmap, weeklyTrend, loading, refreshAll, selectedDate, setSelectedDate } =
    useTokenStore();
  const { accounts, subscriptionByAccount, refreshSubscriptionUsage } = useAccountsStore();

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const unsub = window.mcode.tokens.onUpdated(() => {
      refreshAll();
    });
    return unsub;
  }, [refreshAll]);

  // Fetch subscription usage once on mount — independent of date changes
  useEffect(() => {
    refreshSubscriptionUsage().catch(console.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback((): void => {
    window.mcode.tokens.refresh().then(() => refreshAll()).catch(console.error);
    refreshSubscriptionUsage().catch(console.error);
  }, [refreshAll, refreshSubscriptionUsage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent): void => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key === 'r') {
      e.preventDefault();
      e.stopPropagation();
      handleRefresh();
    }
  }, [handleRefresh]);

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
    if (daysDiff(oldest, prev) >= 0) {
      setSelectedDate(prev);
    }
  };

  const handleNextDay = (): void => {
    if (isToday) return;
    const next = shiftDate(viewDate, 1);
    setSelectedDate(next >= today ? null : next);
  };

  const btnClass =
    'w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors';
  const btnDisabledClass =
    'w-5 h-5 flex items-center justify-center rounded text-text-muted/30 cursor-default';

  const toolbar = (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-border-default shrink-0">
      <span className="text-sm font-medium text-text-primary flex-1">Token Usage</span>
      <Tooltip content="Previous day" side="bottom">
        <button className={canGoBack ? btnClass : btnDisabledClass} onClick={canGoBack ? handlePrevDay : undefined} aria-disabled={!canGoBack}>
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
        <button className={isToday ? btnDisabledClass : btnClass} onClick={isToday ? undefined : handleNextDay} aria-disabled={isToday}>
          <ChevronRight size={12} strokeWidth={2} />
        </button>
      </Tooltip>
      <Tooltip content="Refresh (⌘R)" side="bottom">
        <button className={btnClass} onClick={handleRefresh}>
          <RefreshCw size={12} strokeWidth={2} />
        </button>
      </Tooltip>
    </div>
  );

  if (loading && !dailyUsage) {
    return (
      <div className="flex flex-col h-full w-full bg-bg-primary">
        {toolbar}
        <div className="flex items-center justify-center h-full text-text-muted text-sm">Loading...</div>
      </div>
    );
  }

  const cost = dailyUsage?.estimatedCostUsd ?? 0;
  const messageCount = dailyUsage?.messageCount ?? 0;
  const topSessions = dailyUsage?.topSessions ?? [];
  const byModel = dailyUsage?.byModel ?? [];
  const totals = dailyUsage?.totals;

  // Cache efficiency
  const cacheReadTokens = totals?.cacheReadTokens ?? 0;
  const totalInputTokens = (totals?.inputTokens ?? 0) + cacheReadTokens + (totals?.cacheWrite5mTokens ?? 0) + (totals?.cacheWrite1hTokens ?? 0);
  const cacheHitRate = totalInputTokens > 0 ? cacheReadTokens / totalInputTokens : 0;

  // Cost per message
  const costPerMsg = messageCount > 0 ? cost / messageCount : 0;

  return (
    <div className="flex flex-col h-full w-full bg-bg-primary outline-none" tabIndex={-1} onKeyDown={handleKeyDown}>
      {toolbar}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Headline stats */}
        <div>
          <span className="text-2xl font-semibold text-text-primary">
            {formatCost(cost)}
          </span>
          <span className="text-sm text-text-muted ml-1.5">
            estimated {isToday ? 'today' : `on ${formatDateLabel(viewDate)}`}
          </span>
          {messageCount > 0 && (
            <span className="text-sm text-text-muted ml-1">
              · {messageCount} message{messageCount !== 1 ? 's' : ''}
            </span>
          )}
          {messageCount > 0 && (
            <span className="text-sm text-text-muted ml-1">
              · {formatCost(costPerMsg)}/msg
            </span>
          )}
          {totals && (totalInputTokens > 0 || totals.outputTokens > 0) && (
            <div className="text-xs text-text-muted mt-0.5">
              In: {formatTokens(totalInputTokens)} · Out: {formatTokens(totals.outputTokens)} · Total: {formatTokens(totalInputTokens + totals.outputTokens)}
            </div>
          )}
        </div>

        {/* Heatmap */}
        {heatmap.length > 0 && (
          <HeatmapGrid
            entries={heatmap}
            getLevel={tokenLevel}
            getTooltip={tokenTooltip}
            selectedDate={viewDate}
            onSelect={handleHeatmapSelect}
            colorScale="emerald"
          />
        )}

        {/* Model breakdown */}
        {byModel.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {byModel.map((b) => (
              <ModelPill key={b.model} model={b} totalCost={cost} />
            ))}
          </div>
        )}

        {/* Cache efficiency */}
        {cacheReadTokens > 0 && (
          <div className="text-xs text-text-muted">
            Cache: {Math.round(cacheHitRate * 100)}% hit rate
          </div>
        )}

        {/* Top sessions */}
        {topSessions.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs text-text-muted font-medium">
              Top sessions {isToday ? 'today' : `on ${formatDateLabel(viewDate)}`}
            </div>
            {topSessions.map((s) => (
              <div key={s.claudeSessionId} className="flex items-center text-xs">
                <span className="text-text-secondary truncate flex-1">
                  {s.label ?? s.claudeSessionId.slice(0, 8)}
                </span>
                <span className="text-text-muted shrink-0 ml-2">
                  {formatCost(s.estimatedCostUsd)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Weekly trend */}
        {weeklyTrend && (
          <div className="text-xs text-text-muted">
            This week: {formatCost(weeklyTrend.thisWeek.estimatedCostUsd)}
            {weeklyTrend.pctChange != null && (
              <span className={weeklyTrend.pctChange >= 0 ? 'text-red-400' : 'text-green-400'}>
                {' '}({weeklyTrend.pctChange >= 0 ? '+' : ''}{weeklyTrend.pctChange}% vs last week)
              </span>
            )}
          </div>
        )}

        {/* Usage Quota */}
        {(() => {
          const quotaAccounts = accounts.filter(
            (a) => subscriptionByAccount[a.accountId] != null || a.email != null,
          );
          if (quotaAccounts.length === 0) return null;
          const multiAccount = quotaAccounts.length > 1;
          return (
            <div className="space-y-3">
              <div>
                <div className="text-xs text-text-muted font-medium">Usage Quota</div>
                {!multiAccount && (quotaAccounts[0].email ?? (!quotaAccounts[0].isDefault ? quotaAccounts[0].name : null)) && (
                  <div className="text-xs text-text-muted/70 mt-0.5">{quotaAccounts[0].email ?? quotaAccounts[0].name}</div>
                )}
              </div>
              {quotaAccounts.map((a) => {
                const usage = subscriptionByAccount[a.accountId];
                return usage ? (
                  <UsageQuotaSection
                    key={a.accountId}
                    usage={usage}
                    accountName={multiAccount ? a.name : undefined}
                  />
                ) : (
                  <div key={a.accountId} className="space-y-1.5">
                    {multiAccount && <div className="text-xs text-text-muted font-medium">{a.name}</div>}
                    <div className="text-xs text-text-muted/50">quota unavailable</div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Empty state */}
        {cost === 0 && messageCount === 0 && (
          <div className="text-sm text-text-muted text-center py-4">
            No token usage {selectedDate ? `on ${formatDateLabel(selectedDate)}` : 'today'}
          </div>
        )}
      </div>
    </div>
  );
}

export default TokenStats;
