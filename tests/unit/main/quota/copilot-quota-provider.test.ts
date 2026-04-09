import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/main/copilot-billing-fetcher');

import { CopilotQuotaProvider } from '../../../../src/main/quota/copilot-quota-provider';
import { fetchCopilotBilling } from '../../../../src/main/copilot-billing-fetcher';
import type { CopilotBillingResult } from '../../../../src/main/copilot-billing-fetcher';

const mockFetch = vi.mocked(fetchCopilotBilling);

describe('CopilotQuotaProvider', () => {
  let provider: CopilotQuotaProvider;

  beforeEach(() => {
    provider = new CopilotQuotaProvider();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a snapshot with monthly window on success', async () => {
    mockFetch.mockResolvedValue({
      billing: {
        username: 'testuser',
        usedRequests: 250,
        limitRequests: 500,
        utilization: 50,
        resetsAt: '2026-05-01T00:00:00.000Z',
        fetchedAt: '2026-04-09T12:00:00.000Z',
      },
      error: null,
    });

    const snapshots = await provider.getSnapshots();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      provider: 'copilot',
      sourceId: 'gh-testuser',
      sourceKind: 'account',
      identity: 'testuser',
      sourceLabel: 'testuser',
    });
    expect(snapshots[0].windows).toEqual([
      expect.objectContaining({
        id: 'monthly',
        label: 'Monthly',
        utilization: 50,
        resetsAt: '2026-05-01T00:00:00.000Z',
      }),
    ]);
    expect(snapshots[0].setupHint).toBeUndefined();
  });

  it('returns setupHint for gh-not-installed', async () => {
    mockFetch.mockResolvedValue({ billing: null, error: 'gh-not-installed' });

    const snapshots = await provider.getSnapshots();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].windows).toHaveLength(0);
    expect(snapshots[0].setupHint).toBe('Install GitHub CLI: brew install gh');
    expect(snapshots[0].sourceId).toBe('copilot-setup');
  });

  it('returns setupHint for gh-not-authenticated', async () => {
    mockFetch.mockResolvedValue({ billing: null, error: 'gh-not-authenticated' });

    const snapshots = await provider.getSnapshots();

    expect(snapshots[0].setupHint).toBe('Run: gh auth login');
  });

  it('returns setupHint for scope-missing', async () => {
    mockFetch.mockResolvedValue({ billing: null, error: 'scope-missing' });

    const snapshots = await provider.getSnapshots();

    expect(snapshots[0].setupHint).toBe('Run: gh auth refresh -h github.com -s user');
  });

  it('returns setupHint for api-error', async () => {
    mockFetch.mockResolvedValue({ billing: null, error: 'api-error' });

    const snapshots = await provider.getSnapshots();

    expect(snapshots[0].setupHint).toBe('GitHub API unavailable');
  });

  it('returns empty array when both billing and error are null', async () => {
    mockFetch.mockResolvedValue({ billing: null, error: null } as CopilotBillingResult);

    const snapshots = await provider.getSnapshots();

    expect(snapshots).toHaveLength(0);
  });

  it('passes forceRefresh to fetcher', async () => {
    mockFetch.mockResolvedValue({ billing: null, error: 'gh-not-installed' });

    await provider.getSnapshots(true);

    expect(mockFetch).toHaveBeenCalledWith(true);
  });
});
