import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupMcodeMock } from '../mock-mcode';

const quotaMock = {
  list: vi.fn().mockResolvedValue([
    {
      provider: 'codex',
      sourceId: 'local-codex',
      sourceKind: 'local',
      displayName: 'Codex CLI',
      sourceLabel: 'Local Codex CLI',
      identity: null,
      planType: 'free',
      fetchedAt: '2026-04-07T00:00:00.000Z',
      windows: [{ id: 'primary', label: '1w', utilization: 38, resetsAt: null }],
    },
  ]),
};

setupMcodeMock({
  quota: quotaMock,
});

const { useQuotaStore } = await import('../../../../src/renderer/stores/quota-store');

describe('quota-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQuotaStore.setState({ snapshots: [], loading: false });
  });

  it('loads quota snapshots from IPC', async () => {
    await useQuotaStore.getState().refresh();

    expect(quotaMock.list).toHaveBeenCalledWith(undefined);
    expect(useQuotaStore.getState().snapshots).toHaveLength(1);
    expect(useQuotaStore.getState().snapshots[0].provider).toBe('codex');
    expect(useQuotaStore.getState().loading).toBe(false);
  });

  it('keeps loading false on failure', async () => {
    quotaMock.list.mockRejectedValueOnce(new Error('fail'));

    await useQuotaStore.getState().refresh(true);

    expect(quotaMock.list).toHaveBeenCalledWith(true);
    expect(useQuotaStore.getState().loading).toBe(false);
  });
});
