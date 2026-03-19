import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useCommitStore } from '../../stores/commit-store';
import { useLayoutStore } from '../../stores/layout-store';
import Tooltip from '../shared/Tooltip';
import type { CommitHeatmapEntry } from '../../../shared/types';

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function HeatmapCell({ entry }: { entry: CommitHeatmapEntry }): React.JSX.Element {
  const dayLabel = new Date(entry.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).charAt(0);
  let bg = 'bg-bg-elevated';
  if (entry.count > 0) bg = 'bg-green-900';
  if (entry.count >= 3) bg = 'bg-green-700';
  if (entry.count >= 6) bg = 'bg-green-500';
  if (entry.count >= 10) bg = 'bg-green-400';

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className={`w-5 h-5 rounded-sm ${bg}`}
        title={`${entry.date}: ${entry.count} commits`}
      />
      <span className="text-[9px] text-text-muted">{dayLabel}</span>
    </div>
  );
}

function TypePill({ type, count }: { type: string; count: number }): React.JSX.Element {
  const colors: Record<string, string> = {
    feat: 'bg-green-900/60 text-green-300',
    fix: 'bg-red-900/60 text-red-300',
    refactor: 'bg-blue-900/60 text-blue-300',
    docs: 'bg-purple-900/60 text-purple-300',
    test: 'bg-amber-900/60 text-amber-300',
    chore: 'bg-gray-700/60 text-gray-300',
    other: 'bg-gray-700/60 text-gray-400',
  };
  const color = colors[type] ?? colors.other;

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${color}`}>
      {type} {count}
    </span>
  );
}

function CommitStats(): React.JSX.Element {
  const { dailyStats, heatmap, streaks, cadence, weeklyTrend, loading, refreshAll } = useCommitStore();
  const removeCommitStats = useLayoutStore((s) => s.removeCommitStats);
  const persist = useLayoutStore((s) => s.persist);

  // Load data on mount
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Subscribe to live updates
  useEffect(() => {
    const unsub = window.mcode.commits.onUpdated(() => {
      refreshAll();
    });
    return unsub;
  }, [refreshAll]);

  const handleClose = (): void => {
    removeCommitStats();
    persist();
  };

  if (loading && !dailyStats) {
    return (
      <div className="flex flex-col h-full w-full bg-bg-primary">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default shrink-0">
          <span className="text-sm font-medium text-text-primary flex-1">Commits</span>
          <Tooltip content="Close (⌘W)" side="bottom">
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
              onClick={handleClose}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </Tooltip>
        </div>
        <div className="flex items-center justify-center h-full text-text-muted text-sm">
          Loading...
        </div>
      </div>
    );
  }

  const total = dailyStats?.total ?? 0;
  const totalLines = (dailyStats?.totalInsertions ?? 0) + (dailyStats?.totalDeletions ?? 0);
  const claudeCount = dailyStats?.claudeAssisted ?? 0;
  const soloCount = dailyStats?.soloCount ?? 0;

  return (
    <div className="flex flex-col h-full w-full bg-bg-primary">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default shrink-0">
        <span className="text-sm font-medium text-text-primary flex-1">Commits</span>
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
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-2xl font-semibold text-text-primary">{total}</span>
            <span className="text-sm text-text-secondary ml-1.5">
              commit{total !== 1 ? 's' : ''}
            </span>
            {totalLines > 0 && (
              <span className="text-sm text-text-muted ml-1">
                · {formatNumber(totalLines)} lines
              </span>
            )}
          </div>
          {streaks && streaks.current > 0 && (
            <span className="text-xs text-amber-400 font-medium">
              {streaks.current}d streak
            </span>
          )}
        </div>

        {/* Claude vs solo */}
        {total > 0 && (
          <div className="text-xs text-text-secondary">
            {claudeCount > 0 && (
              <span>{claudeCount} with Claude</span>
            )}
            {claudeCount > 0 && soloCount > 0 && (
              <span className="text-text-muted"> · </span>
            )}
            {soloCount > 0 && (
              <span>{soloCount} solo</span>
            )}
          </div>
        )}

        {/* Heatmap */}
        {heatmap.length > 0 && (
          <div className="flex items-end gap-1">
            {heatmap.map((entry) => (
              <HeatmapCell key={entry.date} entry={entry} />
            ))}
          </div>
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
                <span className="text-text-secondary truncate flex-1">
                  {basename(repo.repoPath)}
                </span>
                <span className="text-text-muted shrink-0 ml-2">
                  {repo.count} commit{repo.count !== 1 ? 's' : ''}
                </span>
                {repo.insertions > 0 && (
                  <span className="text-green-400 shrink-0 ml-2 text-[10px]">
                    +{formatNumber(repo.insertions)}
                  </span>
                )}
                {repo.deletions > 0 && (
                  <span className="text-red-400 shrink-0 ml-1 text-[10px]">
                    -{formatNumber(repo.deletions)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Cadence & trend */}
        {(cadence?.avgMinutes != null || weeklyTrend) && (
          <div className="text-[11px] text-text-muted space-y-0.5">
            {cadence?.avgMinutes != null && (
              <div>
                Cadence: every {cadence.avgMinutes} min
                {cadence.peakHour != null && (
                  <span> · Peak: {formatHour(cadence.peakHour)}</span>
                )}
              </div>
            )}
            {weeklyTrend && (
              <div>
                This week: {weeklyTrend.thisWeek}
                {weeklyTrend.pctChange != null && (
                  <span className={weeklyTrend.pctChange >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {' '}({weeklyTrend.pctChange >= 0 ? '+' : ''}{weeklyTrend.pctChange}% vs last week)
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {total === 0 && (
          <div className="text-sm text-text-muted text-center py-4">
            No commits today
          </div>
        )}
      </div>
    </div>
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

export default CommitStats;
