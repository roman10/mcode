import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/main/claude-subscription-fetcher');

import { ClaudeQuotaProvider } from '../../../../src/main/quota/claude-quota-provider';
import { fetchSubscriptionUsage } from '../../../../src/main/claude-subscription-fetcher';
import type { AccountService } from '../../../../src/main/accounts';
import type { SubscriptionUsage, AccountProfileWithProviders } from '../../../../src/shared/types';

const mockFetch = vi.mocked(fetchSubscriptionUsage);

function makeAccount(overrides: Partial<AccountProfileWithProviders> = {}): AccountProfileWithProviders {
  return {
    accountId: 'acct-1',
    name: 'Default',
    isDefault: true,
    homeDir: null,
    createdAt: '2026-01-01T00:00:00Z',
    lastUsedAt: null,
    providers: {
      claude: {
        accountId: 'acct-1',
        sessionType: 'claude',
        authStatus: 'ok',
        identity: 'user@example.com',
        displayName: 'user@example.com',
        lastCheckedAt: null,
        lastAuthenticatedAt: null,
      },
    },
    ...overrides,
  };
}

function makeAccountService(accounts: AccountProfileWithProviders[]): AccountService {
  return { listWithProviders: () => accounts } as unknown as AccountService;
}

function makeUsage(overrides: Partial<SubscriptionUsage> = {}): SubscriptionUsage {
  return {
    windows: [
      { id: 'five-hour', label: '5-hour', utilization: 70, resetsAt: '2026-07-06T11:00:00Z', kind: 'session' },
      { id: 'seven-day', label: '7-day', utilization: 30, resetsAt: '2026-07-09T10:00:00Z', kind: 'weekly_all' },
      { id: 'seven-day-fable', label: 'Fable', utilization: 21, resetsAt: '2026-07-09T10:00:00Z', kind: 'weekly_scoped' },
    ],
    fetchedAt: '2026-07-06T09:00:00Z',
    ...overrides,
  };
}

describe('ClaudeQuotaProvider', () => {
  let provider: ClaudeQuotaProvider;

  beforeEach(() => {
    provider = new ClaudeQuotaProvider(makeAccountService([makeAccount()]));
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps usage windows to quota windows, carrying kind into limitId', async () => {
    mockFetch.mockResolvedValue(makeUsage());

    const snapshots = await provider.getSnapshots();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      provider: 'claude',
      sourceKind: 'account',
      displayName: 'Claude Code',
      identity: 'user@example.com',
      sourceLabel: 'Default',
      planType: null,
      fetchedAt: '2026-07-06T09:00:00Z',
    });
    expect(snapshots[0].windows).toEqual([
      { id: 'five-hour', label: '5-hour', utilization: 70, resetsAt: '2026-07-06T11:00:00Z', limitId: 'session' },
      { id: 'seven-day', label: '7-day', utilization: 30, resetsAt: '2026-07-09T10:00:00Z', limitId: 'weekly_all' },
      { id: 'seven-day-fable', label: 'Fable', utilization: 21, resetsAt: '2026-07-09T10:00:00Z', limitId: 'weekly_scoped' },
    ]);
  });

  it('returns an empty-windows snapshot when the fetcher returns null but an identity exists', async () => {
    mockFetch.mockResolvedValue(null);

    const snapshots = await provider.getSnapshots();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].windows).toHaveLength(0);
    expect(snapshots[0].identity).toBe('user@example.com');
  });

  it('drops the account entirely when the fetcher returns null and no identity exists', async () => {
    provider = new ClaudeQuotaProvider(makeAccountService([makeAccount({ providers: {} })]));
    mockFetch.mockResolvedValue(null);

    const snapshots = await provider.getSnapshots();

    expect(snapshots).toHaveLength(0);
  });

  it('passes forceRefresh through to the fetcher', async () => {
    mockFetch.mockResolvedValue(makeUsage());

    await provider.getSnapshots(true);

    expect(mockFetch).toHaveBeenCalledWith(expect.anything(), true);
  });
});
