import HeatmapGrid from '../shared/HeatmapGrid';
import SectionDivider from './SectionDivider';
import { formatTimeUntil } from '../../utils/date-nav';
import type {
  DailyTokenUsage,
  TokenHeatmapEntry,
  TokenWeeklyTrend,
  ModelUsageSummary,
  SubscriptionUsage,
  AccountProfile,
} from '@shared/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Component ──────────────────────────────────────────────────────────────

interface CostSectionProps {
  collapsed: boolean;
  onToggle: () => void;
  dailyUsage: DailyTokenUsage | null;
  tokenHeatmap: TokenHeatmapEntry[];
  tokenWeeklyTrend: TokenWeeklyTrend | null;
  accounts: AccountProfile[];
  subscriptionByAccount: Record<string, SubscriptionUsage | null>;
  viewDate: string;
  onHeatmapSelect: (date: string) => void;
  dateLabel: string;
}

function CostSection({
  collapsed,
  onToggle,
  dailyUsage,
  tokenHeatmap,
  tokenWeeklyTrend,
  accounts,
  subscriptionByAccount,
  viewDate,
  onHeatmapSelect,
  dateLabel,
}: CostSectionProps): React.JSX.Element {
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

  return (
    <>
      <SectionDivider
        label="AI Cost"
        collapsed={collapsed}
        onToggle={onToggle}
        summary={`${formatCost(cost)} · ${messageCount} msg${messageCount !== 1 ? 's' : ''}`}
      />

      {!collapsed && (
        <>
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
              onSelect={onHeatmapSelect}
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
        </>
      )}
    </>
  );
}

export default CostSection;
