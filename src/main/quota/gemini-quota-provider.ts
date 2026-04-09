import type { QuotaProviderAdapter } from './quota-provider';
import type { AccountService } from '../accounts';
import type { QuotaSnapshot, QuotaWindow } from '../../shared/types';
import { getAgentDefinition } from '../../shared/session-agents';
import { fetchGeminiBilling } from '../gemini-billing-fetcher';

export class GeminiQuotaProvider implements QuotaProviderAdapter {
  readonly provider = 'gemini' as const;

  constructor(private accountService: AccountService) {}

  async getSnapshots(forceRefresh?: boolean): Promise<QuotaSnapshot[]> {
    const accounts = this.accountService.listWithProviders();
    const snapshots = await Promise.all(
      accounts.map(async (account) => {
        const identity = account.providers?.gemini?.identity ?? null;
        if (!identity) return null;

        const result = await fetchGeminiBilling(account, forceRefresh);
        if (!result || result.buckets.length === 0) {
          return this.buildSnapshot(account.accountId, account.name, identity, null, []);
        }

        const windows: QuotaWindow[] = result.buckets.map((bucket) => ({
          id: bucket.modelId,
          label: formatModelLabel(bucket.modelId),
          utilization: Math.round((1 - bucket.remainingFraction) * 100),
          resetsAt: bucket.resetTime,
        }));

        return this.buildSnapshot(account.accountId, account.name, identity, result.fetchedAt, windows);
      }),
    );

    return snapshots.filter((s): s is QuotaSnapshot => !!s);
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
      displayName: getAgentDefinition(this.provider)?.displayName ?? 'Gemini CLI',
      sourceLabel,
      identity,
      planType: null,
      fetchedAt: fetchedAt ?? new Date().toISOString(),
      windows,
    };
  }
}

/** Shorten "gemini-2.5-pro" → "2.5 Pro", "gemini-2.0-flash" → "2.0 Flash". */
function formatModelLabel(modelId: string): string {
  const stripped = modelId.replace(/^gemini-/, '');
  return stripped
    .split('-')
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}
