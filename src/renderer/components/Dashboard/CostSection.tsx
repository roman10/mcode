import HeatmapGrid from '../shared/HeatmapGrid';
import DailyBarChart from '../shared/DailyBarChart';
import SectionDivider from './SectionDivider';
import { computeRollups } from './stats-helpers';
import { formatTimeUntil } from '../../utils/date-nav';
import type {
  DailyTokenUsage,
  TokenHeatmapEntry,
  ModelUsageSummary,
  QuotaSnapshot,
  QuotaWindow,
} from '@shared/types';
import type { AgentSessionType } from '@shared/session-agents';
import { splitLabelIcon } from '../../utils/label-utils';
import AgentIcon from '../shared/AgentIcon';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCost(usd: number): string {
  if (usd < 0.01) return '< $0.01';
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
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
  gpt: 'bg-teal-900/80 text-teal-300',
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
  windows,
  sourceLabel,
  identity,
}: {
  windows: QuotaWindow[];
  sourceLabel?: string | null;
  identity?: string | null;
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      {sourceLabel && (
        <div className="text-xs text-text-muted font-medium">
          {sourceLabel}{identity ? <span className="text-text-muted/70 font-normal"> · {identity}</span> : null}
        </div>
      )}
      {windows.map((window) => (
        <UsageQuotaBar
          key={window.id}
          label={window.label}
          utilization={window.utilization}
          resetsAt={window.resetsAt}
        />
      ))}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

interface CostSectionProps {
  collapsed: boolean;
  onToggle: () => void;
  dailyUsage: DailyTokenUsage | null;
  tokenHeatmap: TokenHeatmapEntry[];
  quotaSnapshots: QuotaSnapshot[];
  providerFilter: AgentSessionType | null;
  viewDate: string;
  onHeatmapSelect: (date: string) => void;
  dateLabel: string;
}

function CostSection({
  collapsed,
  onToggle,
  dailyUsage,
  tokenHeatmap,
  quotaSnapshots,
  providerFilter,
  viewDate,
  onHeatmapSelect,
  dateLabel,
}: CostSectionProps): React.JSX.Element {
  const cost = dailyUsage?.estimatedCostUsd ?? 0;
  const tokenRollups = computeRollups(tokenHeatmap, e => e.inputTokens + e.outputTokens);
  const costRollups = computeRollups(tokenHeatmap, e => e.estimatedCostUsd);
  const messageCount = dailyUsage?.messageCount ?? 0;
  const premiumRequests = dailyUsage?.premiumRequests ?? 0;
  const topSessions = dailyUsage?.topSessions ?? [];
  const byModel = dailyUsage?.byModel ?? [];
  const totals = dailyUsage?.totals;
  const cacheReadTokens = totals?.cacheReadTokens ?? 0;
  const filteredQuotaSnapshots = quotaSnapshots.filter((snapshot) => {
    if (providerFilter == null) return true;
    return snapshot.provider === providerFilter;
  });
  const quotaGroups = new Map<AgentSessionType, QuotaSnapshot[]>();
  for (const snapshot of filteredQuotaSnapshots) {
    const existing = quotaGroups.get(snapshot.provider) ?? [];
    existing.push(snapshot);
    quotaGroups.set(snapshot.provider, existing);
  }
  const totalInputTokens =
    (totals?.inputTokens ?? 0) +
    cacheReadTokens +
    (totals?.cacheWrite5mTokens ?? 0) +
    (totals?.cacheWrite1hTokens ?? 0);
  const cacheHitRate = totalInputTokens > 0 ? cacheReadTokens / totalInputTokens : 0;
  const costPerMsg = messageCount > 0 ? cost / messageCount : 0;
  // Show cost-based headline when cost > 0, otherwise show token-based headline
  const hasCost = cost > 0;

  return (
    <>
      <SectionDivider
        label="AI Cost"
        collapsed={collapsed}
        onToggle={onToggle}
        summary={
          hasCost
            ? `${formatCost(cost)} · ${messageCount} msg${messageCount !== 1 ? 's' : ''}`
            : premiumRequests > 0
              ? `${premiumRequests} premium req · ${messageCount} msg${messageCount !== 1 ? 's' : ''}`
              : `${messageCount} msg${messageCount !== 1 ? 's' : ''}`
        }
      />

      {!collapsed && (
        <>
          {/* Headline */}
          <div>
            {hasCost ? (
              <>
                <span className="text-2xl font-semibold text-text-primary">{formatCost(cost)}</span>
                <span className="text-sm text-text-muted ml-1.5">estimated {dateLabel}</span>
              </>
            ) : premiumRequests > 0 ? (
              <>
                <span className="text-2xl font-semibold text-text-primary">{premiumRequests}</span>
                <span className="text-sm text-text-muted ml-1.5">premium requests {dateLabel}</span>
              </>
            ) : (
              <span className="text-sm text-text-muted">{dateLabel}</span>
            )}
            {messageCount > 0 && (
              <span className="text-sm text-text-muted ml-1">
                · {messageCount} message{messageCount !== 1 ? 's' : ''}
              </span>
            )}
            {hasCost && messageCount > 0 && (
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
              onSelect={onHeatmapSelect}
              colorScale="emerald"
            />
          )}

          {/* Tokens bar chart */}
          {tokenHeatmap.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-text-muted uppercase tracking-wide">Tokens</span>
                <span className="text-[10px] text-text-muted">
                  7d: {formatTokens(tokenRollups.d7)} · 30d: {formatTokens(tokenRollups.d30)} · 90d: {formatTokens(tokenRollups.d90)}
                </span>
              </div>
              <DailyBarChart
                entries={tokenHeatmap}
                getValue={e => e.inputTokens + e.outputTokens}
                getTooltip={(date, v, avg7, avg30) => `${date}: ${formatTokens(v)} tokens\n7d avg: ${formatTokens(avg7)} · 30d avg: ${formatTokens(avg30)}`}
                colorScale="emerald"
                selectedDate={viewDate}
                onSelect={onHeatmapSelect}
              />
            </div>
          )}

          {/* Cost bar chart */}
          {tokenHeatmap.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-text-muted uppercase tracking-wide">Cost</span>
                <span className="text-[10px] text-text-muted">
                  7d: {formatCost(costRollups.d7)} · 30d: {formatCost(costRollups.d30)} · 90d: {formatCost(costRollups.d90)}
                </span>
              </div>
              <DailyBarChart
                entries={tokenHeatmap}
                getValue={e => e.estimatedCostUsd}
                getTooltip={(date, v, avg7, avg30) => `${date}: ${formatCost(v)}\n7d avg: ${formatCost(avg7)} · 30d avg: ${formatCost(avg30)}`}
                colorScale="amber"
                selectedDate={viewDate}
                onSelect={onHeatmapSelect}
              />
            </div>
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
              {topSessions.map((s) => {
                const [labelIcon, labelText] = splitLabelIcon(s.label ?? s.sessionId.slice(0, 8));
                return (
                <div key={s.sessionId} className="flex items-center text-xs">
                  <span className="text-text-secondary truncate flex-1">
                    {labelIcon && <AgentIcon icon={labelIcon} className="mr-1" />}
                    {labelText}
                  </span>
                  <span className="text-text-muted shrink-0 ml-2">
                    {s.estimatedCostUsd > 0 ? formatCost(s.estimatedCostUsd) : formatTokens(s.outputTokens) + ' out'}
                  </span>
                </div>
                );
              })}
            </div>
          )}

          {quotaGroups.size > 0 && (
            <div className="space-y-3">
              <div className="text-xs text-text-muted font-medium">Usage Quotas</div>
              {Array.from(quotaGroups.entries()).map(([provider, snapshots]) => {
                const multiSource = snapshots.length > 1;
                const first = snapshots[0];
                const singleSubtitle = multiSource
                  ? null
                  : [first.identity, first.sourceKind === 'local' ? first.sourceLabel : null, first.planType]
                    .filter(Boolean)
                    .join(' · ');

                return (
                  <div key={provider} className="space-y-2">
                    <div>
                      <div className="text-xs text-text-secondary font-medium">{first.displayName}</div>
                      {singleSubtitle && <div className="text-xs text-text-muted/70 mt-0.5">{singleSubtitle}</div>}
                    </div>
                    {snapshots.map((snapshot) => (
                      snapshot.windows.length > 0 ? (
                        <UsageQuotaSection
                          key={`${snapshot.provider}:${snapshot.sourceId}`}
                          windows={snapshot.windows}
                          sourceLabel={multiSource ? snapshot.sourceLabel : undefined}
                          identity={multiSource ? snapshot.identity : undefined}
                        />
                      ) : (
                        <div key={`${snapshot.provider}:${snapshot.sourceId}`} className="space-y-1.5">
                          {multiSource && snapshot.sourceLabel && (
                            <div className="text-xs text-text-muted font-medium">
                              {snapshot.sourceLabel}
                              {snapshot.identity ? <span className="text-text-muted/70 font-normal"> · {snapshot.identity}</span> : null}
                            </div>
                          )}
                          <div className="text-xs text-text-muted/50">{snapshot.setupHint ?? 'quota unavailable'}</div>
                        </div>
                      )
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {cost === 0 && messageCount === 0 && (
            <div className="text-sm text-text-muted text-center py-2">No token usage {dateLabel}</div>
          )}
        </>
      )}
    </>
  );
}

export default CostSection;
