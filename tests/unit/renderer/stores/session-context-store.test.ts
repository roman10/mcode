import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMcodeMock } from '../mock-mcode';

const baseUsage = {
  claudeSessionId: '',
  models: [],
  totals: {
    inputTokens: 0, outputTokens: 0,
    cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0,
  },
  estimatedCostUsd: 0,
  messageCount: 0,
  firstMessageAt: null,
  lastMessageAt: null,
  currentContext: null as null | {
    model: string;
    usedTokens: number;
    contextWindow: number | null;
    percent: number | null;
  },
};

const sampleContext = {
  model: 'claude-opus-4-7',
  usedTokens: 89_000,
  contextWindow: 200_000,
  percent: 45,
};

describe('useSessionContextStore', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('caches currentContext by claudeSessionId', async () => {
    setupMcodeMock({
      tokens: {
        getSessionUsage: vi.fn().mockResolvedValue({
          ...baseUsage,
          currentContext: sampleContext,
        }),
      },
    });
    const { useSessionContextStore } = await import('../../../../src/renderer/stores/session-context-store');

    await useSessionContextStore.getState().fetch('sess-A');

    expect(useSessionContextStore.getState().byId['sess-A']).toEqual(sampleContext);
  });

  it('is a no-op when claudeSessionId is null', async () => {
    const getSessionUsage = vi.fn().mockResolvedValue({ ...baseUsage });
    setupMcodeMock({ tokens: { getSessionUsage } });
    const { useSessionContextStore } = await import('../../../../src/renderer/stores/session-context-store');

    await useSessionContextStore.getState().fetch(null);

    expect(getSessionUsage).not.toHaveBeenCalled();
    expect(useSessionContextStore.getState().byId).toEqual({});
  });

  it('dedupes concurrent fetches for the same session id', async () => {
    let resolve!: (value: unknown) => void;
    const inflightPromise = new Promise((r) => { resolve = r; });
    const getSessionUsage = vi.fn().mockReturnValue(inflightPromise);

    setupMcodeMock({ tokens: { getSessionUsage } });
    const { useSessionContextStore } = await import('../../../../src/renderer/stores/session-context-store');

    // Fire two concurrent fetches for the same id; only one underlying call should happen.
    const p1 = useSessionContextStore.getState().fetch('sess-A');
    const p2 = useSessionContextStore.getState().fetch('sess-A');

    expect(getSessionUsage).toHaveBeenCalledTimes(1);

    resolve({ ...baseUsage, currentContext: sampleContext });
    await Promise.all([p1, p2]);

    // After the inflight call resolves, a fresh fetch should be allowed again.
    await useSessionContextStore.getState().fetch('sess-A');
    expect(getSessionUsage).toHaveBeenCalledTimes(2);
  });

  it('does not dedupe across different session ids', async () => {
    const getSessionUsage = vi.fn().mockResolvedValue({ ...baseUsage });
    setupMcodeMock({ tokens: { getSessionUsage } });
    const { useSessionContextStore } = await import('../../../../src/renderer/stores/session-context-store');

    await Promise.all([
      useSessionContextStore.getState().fetch('sess-A'),
      useSessionContextStore.getState().fetch('sess-B'),
    ]);

    expect(getSessionUsage).toHaveBeenCalledTimes(2);
  });

  it('swallows fetch errors without poisoning subsequent fetches', async () => {
    const getSessionUsage = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ...baseUsage, currentContext: sampleContext });

    setupMcodeMock({ tokens: { getSessionUsage } });
    const { useSessionContextStore } = await import('../../../../src/renderer/stores/session-context-store');

    // Silence expected console.error from the rejection. afterEach restores.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await useSessionContextStore.getState().fetch('sess-A');
    // Error path should leave inflight clean so the retry can run.
    await useSessionContextStore.getState().fetch('sess-A');

    expect(getSessionUsage).toHaveBeenCalledTimes(2);
    expect(useSessionContextStore.getState().byId['sess-A']).toEqual(sampleContext);
  });

  it('stores null when currentContext is null (post /clear, post /compact, fresh session)', async () => {
    setupMcodeMock({
      tokens: {
        getSessionUsage: vi.fn().mockResolvedValue({ ...baseUsage, currentContext: null }),
      },
    });
    const { useSessionContextStore } = await import('../../../../src/renderer/stores/session-context-store');

    await useSessionContextStore.getState().fetch('sess-A');
    expect(useSessionContextStore.getState().byId['sess-A']).toBeNull();
    // Key must be present so React selectors don't infinitely refetch on undefined.
    expect('sess-A' in useSessionContextStore.getState().byId).toBe(true);
  });
});
