import { useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useStatsStore } from '../../stores/stats-store';
import { useAccountsStore } from '../../stores/accounts-store';
import Tooltip from '../shared/Tooltip';
import HeatmapGrid from '../shared/HeatmapGrid';
import { todayStr, shiftDate, formatDateLabel, daysDiff, formatTimeUntil } from '../../utils/date-nav';
import type { TokenHeatmapEntry, CommitHeatmapEntry, InputHeatmapEntry, ModelUsageSummary, SubscriptionUsage } from '@shared/types';

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');
const RETENTION_DAYS = 90;

// ─── Token helpers ──────────────────────────────────────────────────────────

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
  const pct = totalCost > 0 ? ((model.estimatedCostUsd / totalCost) * 100).toFixed(0) : '0';
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${color}`}>
      {model.model} {formatCost(model.estimatedCostUsd)} ({pct}%)
    </span>
  );
}

function UsageQuotaBar({
  label,
  utilization,
  resetsAt,
}: {
  label: string;
  utilization: number;
  resetsAt: string | null;
}): React.JSX.Element {
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

function UsageQuotaSection({
  usage,
  accountName,
}: {
  usage: SubscriptionUsage;
  accountName?: string;
}): React.JSX.Element {
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
        <UsageQuotaBar
          label="Opus"
          utilization={usage.sevenDayOpus.utilization}
          resetsAt={usage.sevenDayOpus.resetsAt}
        />
      )}
    </div>
  );
}

// ─── Commit helpers ──────────────────────────────────────────────────────────

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

function TypePill({ type, count }: { type: string; count: number }): React.JSX.Element {
  const colors: Record<string, string> = {
    feat: 'bg-green-900/80 text-green-300',
    fix: 'bg-red-900/80 text-red-300',
    refactor: 'bg-blue-900/80 text-blue-300',
    docs: 'bg-purple-900/80 text-purple-300',
    test: 'bg-amber-900/80 text-amber-300',
    chore: 'bg-gray-700/80 text-gray-300',
    other: 'bg-gray-700/80 text-gray-300',
  };
  const color = colors[type] ?? colors.other;
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${color}`}>
      {type} {count}
    </span>
  );
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatHour(hour: string): string {
  const h = parseInt(hour, 10);
  const nextH = (h + 1) % 24;
  const fmt = (v: number): string => {
    if (v === 0) return '12 AM';
    if (v < 12) return `${v} AM`;
    if (v === 12) return '12 PM';
    return `${v - 12} PM`;
  };
  return `${fmt(h)}-${fmt(nextH)}`;
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

// ─── Input helpers ───────────────────────────────────────────────────────────

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

function formatThinkTime(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  return `${minutes}m`;
}

// ─── Section divider ─────────────────────────────────────────────────────────

function SectionDivider({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-xs text-text-muted/60 uppercase tracking-wider">{label}</span>
      <div className="flex-1 h-px bg-border-default" />
    </div>
  );
}

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

  // ── Commit data ──
  const total = dailyStats?.total ?? 0;
  const totalLines = (dailyStats?.totalInsertions ?? 0) + (dailyStats?.totalDeletions ?? 0);
  const claudeCount = dailyStats?.claudeAssisted ?? 0;
  const soloCount = dailyStats?.soloCount ?? 0;
  const claudePct = total >= 3 && claudeCount > 0 ? Math.round((claudeCount / total) * 100) : null;

  // ── Token data ──
  const cost = dailyUsage?.estimatedCostUsd ?? 0;
  const messageCount = dailyUsage?.messageCount ?? 0;
  const topSessions = dailyUsage?.topSessions ?? [];
  const byModel = dailyUsage?.byModel ?? [];
  const totals = dailyUsage?.totals;
  const cacheReadTokens = totals?.cacheReadTokens ?? 0;
  const totalInputTokens =
    (totals?.inputTokens ?? 0) +
    cacheReadTokens +
    (totals?.cacheWrite5mTokens ?? 0) +
    (totals?.cacheWrite1hTokens ?? 0);
  const cacheHitRate = totalInputTokens > 0 ? cacheReadTokens / totalInputTokens : 0;
  const costPerMsg = messageCount > 0 ? cost / messageCount : 0;

  // ── Input data ──
  const inputMsgCount = dailyInputStats?.messageCount ?? 0;
  const inputChars = dailyInputStats?.totalCharacters ?? 0;
  const inputWords = dailyInputStats?.totalWords ?? 0;
  const inputSessions = dailyInputStats?.activeSessionCount ?? 0;
  const msgsPerCommit = dailyInputStats?.messagesPerCommit;

  const dateLabel = isToday ? 'today' : `on ${formatDateLabel(viewDate)}`;

  return (
    <div className="flex flex-col h-full w-full bg-bg-primary outline-none" tabIndex={-1} onKeyDown={handleKeyDown}>
      {toolbar}

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* ── INPUT SECTION ── */}
        <SectionDivider label="Input" />

        {/* Headline */}
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-2xl font-semibold text-text-primary">{inputMsgCount}</span>
            <span className="text-sm text-text-secondary ml-1.5">message{inputMsgCount !== 1 ? 's' : ''}</span>
            {inputSessions > 0 && (
              <span className="text-sm text-text-muted ml-1">
                · {inputSessions} session{inputSessions !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {msgsPerCommit != null && (
            <span className="text-xs text-blue-400 font-medium">{msgsPerCommit} msgs/commit</span>
          )}
        </div>

        {/* Character / word count */}
        {inputMsgCount > 0 && (
          <div className="text-xs text-text-muted">
            {formatNumber(inputChars)} characters · {formatNumber(inputWords)} words
          </div>
        )}

        {/* Input heatmap */}
        {inputHeatmap.length > 0 && (
          <HeatmapGrid
            entries={inputHeatmap}
            getLevel={inputLevel}
            getTooltip={inputTooltip}
            selectedDate={viewDate}
            onSelect={handleHeatmapSelect}
            colorScale="blue"
          />
        )}

        {/* Cadence & trend */}
        {(inputCadence?.avgThinkTimeMinutes != null || inputCadence?.leverageRatio != null || inputCadence?.peakHour != null) && (
          <div className="text-xs text-text-muted space-y-0.5">
            {inputCadence.avgThinkTimeMinutes != null && (
              <div>
                Think time: {formatThinkTime(inputCadence.avgThinkTimeMinutes)} avg
                {inputCadence.leverageRatio != null && <span> · Leverage: {inputCadence.leverageRatio}x</span>}
              </div>
            )}
            {inputCadence.peakHour != null && <div>Peak: {formatHour(inputCadence.peakHour)}</div>}
          </div>
        )}

        {/* Weekly trend */}
        {inputWeeklyTrend && (
          <div className="text-xs text-text-muted">
            This week: {inputWeeklyTrend.thisWeek.messageCount} messages
            {inputWeeklyTrend.pctChange != null && (
              <span className={inputWeeklyTrend.pctChange >= 0 ? 'text-blue-400' : 'text-text-muted'}>
                {' '}
                ({inputWeeklyTrend.pctChange >= 0 ? '+' : ''}
                {inputWeeklyTrend.pctChange}% vs last week)
              </span>
            )}
          </div>
        )}

        {inputMsgCount === 0 && (
          <div className="text-sm text-text-muted text-center py-2">No human messages {dateLabel}</div>
        )}

        {/* ── OUTPUT SECTION ── */}
        <SectionDivider label="Output" />

        {/* Headline */}
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-2xl font-semibold text-text-primary">{total}</span>
            <span className="text-sm text-text-secondary ml-1.5">commit{total !== 1 ? 's' : ''}</span>
            {totalLines > 0 && (
              <span className="text-sm text-text-muted ml-1">· {formatNumber(totalLines)} lines</span>
            )}
          </div>
          {streaks && streaks.current > 0 && (
            <span className="text-xs text-amber-400 font-medium">
              {streaks.current}d streak
              {streaks.longest > streaks.current && (
                <span className="text-text-muted font-normal"> · best {streaks.longest}d</span>
              )}
            </span>
          )}
        </div>

        {/* Claude vs solo */}
        {total > 0 && (
          <div className="text-xs text-text-secondary">
            {claudePct != null ? (
              <>
                <span className="text-green-400 font-medium">{claudePct}%</span>
                <span> with Claude</span>
                {soloCount > 0 && (
                  <>
                    <span className="text-text-muted"> · </span>
                    <span>{soloCount} solo</span>
                  </>
                )}
              </>
            ) : (
              <>
                {claudeCount > 0 && <span>{claudeCount} with Claude</span>}
                {claudeCount > 0 && soloCount > 0 && <span className="text-text-muted"> · </span>}
                {soloCount > 0 && <span>{soloCount} solo</span>}
              </>
            )}
          </div>
        )}

        {/* Commit heatmap */}
        {commitHeatmap.length > 0 && (
          <HeatmapGrid
            entries={commitHeatmap}
            getLevel={commitLevel}
            getTooltip={commitTooltip}
            selectedDate={viewDate}
            onSelect={handleHeatmapSelect}
            colorScale="green"
          />
        )}

        {/* Commit types */}
        {dailyStats && dailyStats.byType.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {dailyStats.byType.map((t) => (
              <TypePill key={t.type} type={t.type} count={t.count} />
            ))}
          </div>
        )}

        {/* Per-repo breakdown */}
        {dailyStats && dailyStats.byRepo.length > 0 && (
          <div className="space-y-1.5">
            {dailyStats.byRepo.map((repo) => (
              <div key={repo.repoPath} className="flex items-center text-xs">
                <span className="text-text-secondary truncate flex-1">{basename(repo.repoPath)}</span>
                <span className="text-text-muted shrink-0 ml-2">
                  {repo.count} commit{repo.count !== 1 ? 's' : ''}
                </span>
                {repo.insertions > 0 && (
                  <span className="text-green-400 shrink-0 ml-2 text-xs">+{formatNumber(repo.insertions)}</span>
                )}
                {repo.deletions > 0 && (
                  <span className="text-red-400 shrink-0 ml-1 text-xs">-{formatNumber(repo.deletions)}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Cadence & weekly trend */}
        {(cadence?.avgMinutes != null || commitWeeklyTrend) && (
          <div className="text-xs text-text-muted space-y-0.5">
            {cadence?.avgMinutes != null && (
              <div>
                Cadence: every {cadence.avgMinutes} min
                {cadence.peakHour != null && <span> · Peak: {formatHour(cadence.peakHour)}</span>}
              </div>
            )}
            {commitWeeklyTrend && (
              <div>
                This week: {commitWeeklyTrend.thisWeek}
                {commitWeeklyTrend.pctChange != null && (
                  <span className={commitWeeklyTrend.pctChange >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {' '}
                    ({commitWeeklyTrend.pctChange >= 0 ? '+' : ''}
                    {commitWeeklyTrend.pctChange}% vs last week)
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {total === 0 && (
          <div className="text-sm text-text-muted text-center py-2">No commits {dateLabel}</div>
        )}

        {/* ── AI COST SECTION ── */}
        <SectionDivider label="AI Cost" />

        {/* Headline */}
        <div>
          <span className="text-2xl font-semibold text-text-primary">{formatCost(cost)}</span>
          <span className="text-sm text-text-muted ml-1.5">estimated {dateLabel}</span>
          {messageCount > 0 && (
            <span className="text-sm text-text-muted ml-1">
              · {messageCount} message{messageCount !== 1 ? 's' : ''}
            </span>
          )}
          {messageCount > 0 && (
            <span className="text-sm text-text-muted ml-1">· {formatCost(costPerMsg)}/msg</span>
          )}
          {totals && (totalInputTokens > 0 || totals.outputTokens > 0) && (
            <div className="text-xs text-text-muted mt-0.5">
              In: {formatTokens(totalInputTokens)} · Out: {formatTokens(totals.outputTokens)} · Total:{' '}
              {formatTokens(totalInputTokens + totals.outputTokens)}
            </div>
          )}
        </div>

        {/* Token heatmap */}
        {tokenHeatmap.length > 0 && (
          <HeatmapGrid
            entries={tokenHeatmap}
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
          <div className="text-xs text-text-muted">Cache: {Math.round(cacheHitRate * 100)}% hit rate</div>
        )}

        {/* Top sessions */}
        {topSessions.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs text-text-muted font-medium">Top sessions {dateLabel}</div>
            {topSessions.map((s) => (
              <div key={s.claudeSessionId} className="flex items-center text-xs">
                <span className="text-text-secondary truncate flex-1">
                  {s.label ?? s.claudeSessionId.slice(0, 8)}
                </span>
                <span className="text-text-muted shrink-0 ml-2">{formatCost(s.estimatedCostUsd)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Weekly trend */}
        {tokenWeeklyTrend && (
          <div className="text-xs text-text-muted">
            This week: {formatCost(tokenWeeklyTrend.thisWeek.estimatedCostUsd)}
            {tokenWeeklyTrend.pctChange != null && (
              <span className={tokenWeeklyTrend.pctChange >= 0 ? 'text-red-400' : 'text-green-400'}>
                {' '}
                ({tokenWeeklyTrend.pctChange >= 0 ? '+' : ''}
                {tokenWeeklyTrend.pctChange}% vs last week)
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
                {!multiAccount &&
                  (quotaAccounts[0].email ??
                    (!quotaAccounts[0].isDefault ? quotaAccounts[0].name : null)) && (
                    <div className="text-xs text-text-muted/70 mt-0.5">
                      {quotaAccounts[0].email ?? quotaAccounts[0].name}
                    </div>
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

        {cost === 0 && messageCount === 0 && (
          <div className="text-sm text-text-muted text-center py-2">No token usage {dateLabel}</div>
        )}
      </div>
    </div>
  );
}

export default StatsPanel;
