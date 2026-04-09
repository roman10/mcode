import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/main/gemini-billing-fetcher');

import { GeminiQuotaProvider } from '../../../../src/main/quota/gemini-quota-provider';
import { fetchGeminiBilling } from '../../../../src/main/gemini-billing-fetcher';
import type { GeminiBillingResult } from '../../../../src/main/gemini-billing-fetcher';
import type { AccountService } from '../../../../src/main/accounts';
import type { AccountProfileWithProviders } from '../../../../src/shared/types';

const mockFetch = vi.mocked(fetchGeminiBilling);

function makeAccount(overrides: Partial<AccountProfileWithProviders> = {}): AccountProfileWithProviders {
  return {
    accountId: 'acct-1',
    name: 'Default',
    isDefault: true,
    homeDir: null,
    createdAt: '2026-01-01T00:00:00Z',
    lastUsedAt: null,
    providers: {
      gemini: {
        accountId: 'acct-1',
        sessionType: 'gemini',
        authStatus: 'ok',
        identity: 'user@gmail.com',
        displayName: 'user@gmail.com',
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

describe('GeminiQuotaProvider', () => {
  let provider: GeminiQuotaProvider;

  beforeEach(() => {
    provider = new GeminiQuotaProvider(makeAccountService([makeAccount()]));
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a snapshot with per-model windows on success', async () => {
    const result: GeminiBillingResult = {
      buckets: [
        { modelId: 'gemini-2.5-pro', remainingFraction: 0.75, resetTime: '2026-04-10T00:00:00Z' },
        { modelId: 'gemini-2.5-flash', remainingFraction: 0.5, resetTime: '2026-04-10T00:00:00Z' },
      ],
      fetchedAt: '2026-04-09T12:00:00Z',
    };
    mockFetch.mockResolvedValue(result);

    const snapshots = await provider.getSnapshots();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      provider: 'gemini',
      sourceKind: 'account',
      identity: 'user@gmail.com',
      sourceLabel: 'Default',
    });
    expect(snapshots[0].windows).toEqual([
      expect.objectContaining({ id: 'gemini-2.5-pro', label: '2.5 Pro', utilization: 25, resetsAt: '2026-04-10T00:00:00Z' }),
      expect.objectContaining({ id: 'gemini-2.5-flash', label: '2.5 Flash', utilization: 50, resetsAt: '2026-04-10T00:00:00Z' }),
    ]);
  });

  it('returns empty snapshot (no windows) when fetcher returns null', async () => {
    mockFetch.mockResolvedValue(null);

    const snapshots = await provider.getSnapshots();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].windows).toHaveLength(0);
    expect(snapshots[0].identity).toBe('user@gmail.com');
  });

  it('returns empty array when no Gemini identity exists', async () => {
    const noGemini = makeAccount({
      providers: {},
    });
    provider = new GeminiQuotaProvider(makeAccountService([noGemini]));

    const snapshots = await provider.getSnapshots();

    expect(snapshots).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns empty snapshot when fetcher returns empty buckets', async () => {
    mockFetch.mockResolvedValue({ buckets: [], fetchedAt: '2026-04-09T12:00:00Z' });

    const snapshots = await provider.getSnapshots();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].windows).toHaveLength(0);
  });

  it('passes forceRefresh to fetcher', async () => {
    mockFetch.mockResolvedValue(null);

    await provider.getSnapshots(true);

    expect(mockFetch).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('computes utilization correctly from remainingFraction', async () => {
    mockFetch.mockResolvedValue({
      buckets: [
        { modelId: 'gemini-2.5-pro', remainingFraction: 0, resetTime: null },   // 100% used
        { modelId: 'gemini-2.5-flash', remainingFraction: 1, resetTime: null },  // 0% used
      ],
      fetchedAt: '2026-04-09T12:00:00Z',
    });

    const snapshots = await provider.getSnapshots();
    const windows = snapshots[0].windows;

    expect(windows[0].utilization).toBe(100);
    expect(windows[1].utilization).toBe(0);
  });

  it('handles multiple accounts with Gemini identity', async () => {
    const accounts = [
      makeAccount({ accountId: 'acct-1', name: 'Account 1' }),
      makeAccount({
        accountId: 'acct-2',
        name: 'Account 2',
        providers: {
          gemini: {
            accountId: 'acct-2',
            sessionType: 'gemini',
            authStatus: 'ok',
            identity: 'user2@gmail.com',
            displayName: 'user2@gmail.com',
            lastCheckedAt: null,
            lastAuthenticatedAt: null,
          },
        },
      }),
    ];
    provider = new GeminiQuotaProvider(makeAccountService(accounts));

    mockFetch.mockResolvedValue({
      buckets: [{ modelId: 'gemini-2.5-pro', remainingFraction: 0.6, resetTime: null }],
      fetchedAt: '2026-04-09T12:00:00Z',
    });

    const snapshots = await provider.getSnapshots();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].sourceId).toBe('acct-1');
    expect(snapshots[1].sourceId).toBe('acct-2');
    expect(snapshots[1].identity).toBe('user2@gmail.com');
  });
});
