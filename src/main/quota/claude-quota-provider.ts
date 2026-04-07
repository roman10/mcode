import type { QuotaProviderAdapter } from './quota-provider';
import type { AccountService } from '../accounts';
import { fetchSubscriptionUsage } from '../claude-subscription-fetcher';
import type { QuotaSnapshot, QuotaWindow } from '../../shared/types';
import { getAgentDefinition } from '../../shared/session-agents';

export class ClaudeQuotaProvider implements QuotaProviderAdapter {
  readonly provider = 'claude' as const;

  constructor(private accountService: AccountService) {}

  async getSnapshots(forceRefresh?: boolean): Promise<QuotaSnapshot[]> {
    const accounts = this.accountService.listWithProviders();
    const snapshots = await Promise.all(
      accounts.map(async (account) => {
        const usage = await fetchSubscriptionUsage(account, forceRefresh);
        const identity = account.providers?.claude?.identity ?? null;

        if (!usage) {
          if (!identity) return null;
          return this.buildSnapshot(account.accountId, account.name, identity, null, []);
        }

        const windows: QuotaWindow[] = [
          usage.fiveHour ? { id: 'five-hour', label: '5-hour', utilization: usage.fiveHour.utilization, resetsAt: usage.fiveHour.resetsAt } : null,
          usage.sevenDay ? { id: 'seven-day', label: '7-day', utilization: usage.sevenDay.utilization, resetsAt: usage.sevenDay.resetsAt } : null,
          usage.sevenDayOpus ? { id: 'seven-day-opus', label: 'Opus', utilization: usage.sevenDayOpus.utilization, resetsAt: usage.sevenDayOpus.resetsAt } : null,
        ].filter((value): value is QuotaWindow => !!value);

        return this.buildSnapshot(account.accountId, account.name, identity, usage.fetchedAt, windows);
      }),
    );

    return snapshots.filter((value): value is QuotaSnapshot => !!value);
  }

  private buildSnapshot(
    sourceId: string,
    sourceLabel: string,
    identity: string | null,
    fetchedAt: string | null,
    windows: QuotaWindow[],
  ): QuotaSnapshot {
    return {
      provider: this.provider,
      sourceId,
      sourceKind: 'account',
      displayName: getAgentDefinition(this.provider)?.displayName ?? 'Claude Code',
      sourceLabel,
      identity,
      planType: null,
      fetchedAt: fetchedAt ?? new Date().toISOString(),
      windows,
    };
  }
}
