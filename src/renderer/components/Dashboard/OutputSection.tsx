import HeatmapGrid from '../shared/HeatmapGrid';
import SectionDivider from './SectionDivider';
import { formatNumber, formatHour } from './stats-helpers';
import type { DailyCommitStats, CommitHeatmapEntry, CommitStreakInfo, CommitCadenceInfo, CommitWeeklyTrend } from '@shared/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface OutputSectionProps {
  collapsed: boolean;
  onToggle: () => void;
  dailyStats: DailyCommitStats | null;
  commitHeatmap: CommitHeatmapEntry[];
  streaks: CommitStreakInfo | null;
  cadence: CommitCadenceInfo | null;
  commitWeeklyTrend: CommitWeeklyTrend | null;
  viewDate: string;
  onHeatmapSelect: (date: string) => void;
  dateLabel: string;
}

function OutputSection({
  collapsed,
  onToggle,
  dailyStats,
  commitHeatmap,
  streaks,
  cadence,
  commitWeeklyTrend,
  viewDate,
  onHeatmapSelect,
  dateLabel,
}: OutputSectionProps): React.JSX.Element {
  const total = dailyStats?.total ?? 0;
  const totalLines = (dailyStats?.totalInsertions ?? 0) + (dailyStats?.totalDeletions ?? 0);
  const claudeCount = dailyStats?.claudeAssisted ?? 0;
  const soloCount = dailyStats?.soloCount ?? 0;
  const claudePct = total >= 3 && claudeCount > 0 ? Math.round((claudeCount / total) * 100) : null;

  return (
    <>
      <SectionDivider
        label="Output"
        collapsed={collapsed}
        onToggle={onToggle}
        summary={`${total} commit${total !== 1 ? 's' : ''} · ${formatNumber(totalLines)} lines`}
      />

      {!collapsed && (
        <>
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

          {/* AI-assisted vs solo */}
          {total > 0 && (
            <div className="text-xs text-text-secondary">
              {claudePct != null ? (
                <>
                  <span className="text-green-400 font-medium">{claudePct}%</span>
                  <span> AI-assisted</span>
                  {soloCount > 0 && (
                    <>
                      <span className="text-text-muted"> · </span>
                      <span>{soloCount} solo</span>
                    </>
                  )}
                </>
              ) : (
                <>
                  {claudeCount > 0 && <span>{claudeCount} AI-assisted</span>}
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
              onSelect={onHeatmapSelect}
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
        </>
      )}
    </>
  );
}

export default OutputSection;
