import { useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { useTokenStore } from '../../stores/token-store';
import { useLayoutStore } from '../../stores/layout-store';
import type { TokenHeatmapEntry, ModelTokenBreakdown } from '../../../shared/types';

function formatCost(usd: number): string {
  if (usd < 0.01) return '< $0.01';
  return `$${usd.toFixed(2)}`;
}

function HeatmapCell({ entry }: { entry: TokenHeatmapEntry }): React.JSX.Element {
  const dayLabel = new Date(entry.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).charAt(0);
  let bg = 'bg-bg-elevated';
  if (entry.estimatedCostUsd > 0) bg = 'bg-emerald-900';
  if (entry.estimatedCostUsd >= 1) bg = 'bg-emerald-700';
  if (entry.estimatedCostUsd >= 5) bg = 'bg-emerald-500';
  if (entry.estimatedCostUsd >= 10) bg = 'bg-emerald-400';

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className={`w-5 h-5 rounded-sm ${bg}`}
        title={`${entry.date}: ${formatCost(entry.estimatedCostUsd)} · ${entry.messageCount} msgs`}
      />
      <span className="text-[9px] text-text-muted">{dayLabel}</span>
    </div>
  );
}

const modelFamilyColors: Record<string, string> = {
  opus: 'bg-purple-900/60 text-purple-300',
  sonnet: 'bg-blue-900/60 text-blue-300',
  haiku: 'bg-green-900/60 text-green-300',
  unknown: 'bg-gray-700/60 text-gray-400',
};

function ModelPill({ breakdown }: { breakdown: ModelTokenBreakdown }): React.JSX.Element {
  const color = modelFamilyColors[breakdown.modelFamily] ?? modelFamilyColors.unknown;

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${color}`}>
      {breakdown.model} {formatCost(breakdown.estimatedCostUsd)} ({breakdown.pctOfTotalCost.toFixed(0)}%)
    </span>
  );
}

function TokenStats(): React.JSX.Element {
  const { dailyUsage, heatmap, modelBreakdown, weeklyTrend, loading, refreshAll } = useTokenStore();
  const removeTokenStats = useLayoutStore((s) => s.removeTokenStats);
  const persist = useLayoutStore((s) => s.persist);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const unsub = window.mcode.tokens.onUpdated(() => {
      refreshAll();
    });
    return unsub;
  }, [refreshAll]);

  const handleClose = (): void => {
    removeTokenStats();
    persist();
  };

  const handleRefresh = (): void => {
    window.mcode.tokens.refresh().then(() => refreshAll()).catch(console.error);
  };

  if (loading && !dailyUsage) {
    return (
      <div className="flex flex-col h-full w-full bg-bg-primary">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default shrink-0">
          <span className="text-sm font-medium text-text-primary flex-1">Token Usage</span>
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
            onClick={handleClose}
          >
            <X size={12} strokeWidth={2} />
          </button>
        </div>
        <div className="flex items-center justify-center h-full text-text-muted text-sm">
          Loading...
        </div>
      </div>
    );
  }

  const cost = dailyUsage?.estimatedCostUsd ?? 0;
  const messageCount = dailyUsage?.messageCount ?? 0;
  const topSessions = dailyUsage?.topSessions ?? [];

  return (
    <div className="flex flex-col h-full w-full bg-bg-primary">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default shrink-0">
        <span className="text-sm font-medium text-text-primary flex-1">Token Usage</span>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
          onClick={handleRefresh}
          title="Refresh token data"
        >
          <RefreshCw size={12} strokeWidth={2} />
        </button>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
          onClick={handleClose}
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Headline stats */}
        <div>
          <span className="text-2xl font-semibold text-text-primary">
            {formatCost(cost)}
          </span>
          <span className="text-sm text-text-muted ml-1.5">estimated today</span>
          {messageCount > 0 && (
            <span className="text-sm text-text-muted ml-1">
              · {messageCount} message{messageCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Heatmap */}
        {heatmap.length > 0 && (
          <div className="flex items-end gap-1">
            {heatmap.map((entry) => (
              <HeatmapCell key={entry.date} entry={entry} />
            ))}
          </div>
        )}

        {/* Model breakdown */}
        {modelBreakdown.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {modelBreakdown.map((b) => (
              <ModelPill key={b.model} breakdown={b} />
            ))}
          </div>
        )}

        {/* Top sessions */}
        {topSessions.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] text-text-muted font-medium">Top sessions today</div>
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
          <div className="text-[11px] text-text-muted">
            This week: {formatCost(weeklyTrend.thisWeek.estimatedCostUsd)}
            {weeklyTrend.pctChange != null && (
              <span className={weeklyTrend.pctChange >= 0 ? 'text-red-400' : 'text-green-400'}>
                {' '}({weeklyTrend.pctChange >= 0 ? '+' : ''}{weeklyTrend.pctChange}% vs last week)
              </span>
            )}
          </div>
        )}

        {/* Empty state */}
        {cost === 0 && messageCount === 0 && (
          <div className="text-sm text-text-muted text-center py-4">
            No token usage today
          </div>
        )}
      </div>
    </div>
  );
}

export default TokenStats;
