import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupMcodeMock } from '../mock-mcode';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockDailyUsage = {
  date: '2025-03-25',
  estimatedCostUsd: 2.14,
  messageCount: 84,
  totals: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 },
  byModel: [],
  topSessions: [],
};

const mockTokenHeatmap = [{ date: '2025-03-25', estimatedCostUsd: 2.14, messageCount: 84, inputTokens: 1000, outputTokens: 500 }];

const mockDailyStats = {
  date: '2025-03-25',
  total: 5,
  totalInsertions: 120,
  totalDeletions: 30,
  aiAssisted: 4,
  soloCount: 1,
  byRepo: [],
  byType: [],
};

const mockCommitHeatmap = [{ date: '2025-03-25', count: 5, insertions: 120 }];
const mockStreaks = { current: 3, longest: 10 };
const mockCadence = { avgMinutes: 45, peakHour: '14', commitsByHour: {} };

const mockDailyInputStats = {
  date: '2025-03-25',
  total: 12,
  byType: [],
};

const mockInputHeatmap = [{ date: '2025-03-25', count: 12 }];
const mockInputCadence = { avgMinutes: 30, peakHour: '10', inputsByHour: {} };

// ── Mocks ─────────────────────────────────────────────────────────────────────

const tokensMock = {
  getDailyUsage: vi.fn().mockResolvedValue(mockDailyUsage),
  getHeatmap: vi.fn().mockResolvedValue(mockTokenHeatmap),
};

const commitsMock = {
  getDailyStats: vi.fn().mockResolvedValue(mockDailyStats),
  getHeatmap: vi.fn().mockResolvedValue(mockCommitHeatmap),
  getStreaks: vi.fn().mockResolvedValue(mockStreaks),
  getCadence: vi.fn().mockResolvedValue(mockCadence),
};

const inputMock = {
  getDailyStats: vi.fn().mockResolvedValue(mockDailyInputStats),
  getHeatmap: vi.fn().mockResolvedValue(mockInputHeatmap),
  getCadence: vi.fn().mockResolvedValue(mockInputCadence),
};

setupMcodeMock({
  tokens: tokensMock,
  commits: commitsMock,
  input: inputMock,
});

const { useStatsStore } = await import('../../../../src/renderer/stores/stats-store');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('stats-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStatsStore.setState({
      dailyUsage: null,
      tokenHeatmap: [],
      dailyStats: null,
      commitHeatmap: [],
      streaks: null,
      cadence: null,
      dailyInputStats: null,
      inputHeatmap: [],
      inputCadence: null,
      loading: false,
      selectedDate: null,
      providerFilter: null,
    });
  });

  describe('initial state', () => {
    it('has correct null/empty initial values', () => {
      const state = useStatsStore.getState();
      expect(state.dailyUsage).toBeNull();
      expect(state.tokenHeatmap).toEqual([]);
      expect(state.dailyStats).toBeNull();
      expect(state.commitHeatmap).toEqual([]);
      expect(state.streaks).toBeNull();
      expect(state.cadence).toBeNull();
      expect(state.dailyInputStats).toBeNull();
      expect(state.inputHeatmap).toEqual([]);
      expect(state.inputCadence).toBeNull();
      expect(state.loading).toBe(false);
      expect(state.selectedDate).toBeNull();
      expect(state.providerFilter).toBeNull();
    });
  });

  describe('refreshAll', () => {
    it('fetches all 9 IPC calls and populates state', async () => {
      await useStatsStore.getState().refreshAll();

      const dateLike = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/);
      expect(tokensMock.getDailyUsage).toHaveBeenCalledWith(undefined, undefined);
      expect(tokensMock.getHeatmap).toHaveBeenCalledWith(dateLike, dateLike, undefined);
      expect(commitsMock.getDailyStats).toHaveBeenCalledWith(undefined, undefined);
      expect(commitsMock.getHeatmap).toHaveBeenCalledWith(dateLike, dateLike, undefined);
      expect(commitsMock.getStreaks).toHaveBeenCalledWith(undefined);
      expect(commitsMock.getCadence).toHaveBeenCalledWith(undefined, undefined);
      expect(inputMock.getDailyStats).toHaveBeenCalledWith(undefined, undefined);
      expect(inputMock.getHeatmap).toHaveBeenCalledWith(dateLike, dateLike, undefined);
      expect(inputMock.getCadence).toHaveBeenCalledWith(undefined, undefined);

      const state = useStatsStore.getState();
      expect(state.dailyUsage).toEqual(mockDailyUsage);
      expect(state.tokenHeatmap).toEqual(mockTokenHeatmap);
      expect(state.dailyStats).toEqual(mockDailyStats);
      expect(state.commitHeatmap).toEqual(mockCommitHeatmap);
      expect(state.streaks).toEqual(mockStreaks);
      expect(state.cadence).toEqual(mockCadence);
      expect(state.dailyInputStats).toEqual(mockDailyInputStats);
      expect(state.inputHeatmap).toEqual(mockInputHeatmap);
      expect(state.inputCadence).toEqual(mockInputCadence);
      expect(state.loading).toBe(false);
    });

    it('passes selectedDate to date-specific IPC calls', async () => {
      useStatsStore.setState({ selectedDate: '2025-03-20' });
      await useStatsStore.getState().refreshAll();

      expect(tokensMock.getDailyUsage).toHaveBeenCalledWith('2025-03-20', undefined);
      expect(commitsMock.getDailyStats).toHaveBeenCalledWith('2025-03-20', undefined);
      expect(commitsMock.getCadence).toHaveBeenCalledWith('2025-03-20', undefined);
      expect(inputMock.getDailyStats).toHaveBeenCalledWith('2025-03-20', undefined);
      expect(inputMock.getCadence).toHaveBeenCalledWith('2025-03-20', undefined);
    });

    it('sets loading: false on error and does not crash', async () => {
      tokensMock.getDailyUsage.mockRejectedValueOnce(new Error('IPC error'));

      await useStatsStore.getState().refreshAll();

      expect(useStatsStore.getState().loading).toBe(false);
    });
  });

  describe('setSelectedDate', () => {
    it('updates selectedDate and only fires date-dependent IPC calls (not heatmap/streaks)', async () => {
      await useStatsStore.getState().setSelectedDate('2025-03-10');

      expect(useStatsStore.getState().selectedDate).toBe('2025-03-10');
      // Daily slice — must fire
      expect(tokensMock.getDailyUsage).toHaveBeenCalledWith('2025-03-10', undefined);
      expect(commitsMock.getDailyStats).toHaveBeenCalledWith('2025-03-10', undefined);
      expect(commitsMock.getCadence).toHaveBeenCalledWith('2025-03-10', undefined);
      expect(inputMock.getDailyStats).toHaveBeenCalledWith('2025-03-10', undefined);
      expect(inputMock.getCadence).toHaveBeenCalledWith('2025-03-10', undefined);
      // Range slice — must NOT fire on date change (heatmaps span a fixed 90-day window)
      expect(tokensMock.getHeatmap).not.toHaveBeenCalled();
      expect(commitsMock.getHeatmap).not.toHaveBeenCalled();
      expect(commitsMock.getStreaks).not.toHaveBeenCalled();
      expect(inputMock.getHeatmap).not.toHaveBeenCalled();
    });

    it('accepts null (= today) and passes undefined to date-specific calls', async () => {
      useStatsStore.setState({ selectedDate: '2025-03-10' });
      await useStatsStore.getState().setSelectedDate(null);

      expect(useStatsStore.getState().selectedDate).toBeNull();
      expect(tokensMock.getDailyUsage).toHaveBeenCalledWith(undefined, undefined);
    });

    it('drops a stale refreshDaily resolution when superseded by a newer call (epoch guard)', async () => {
      // Hold the first call's getDailyUsage open; the second call resolves immediately
      // with newer data. Without the epoch guard, the first call's late resolution
      // would stomp the second call's state.
      let resolveStale!: (val: typeof mockDailyUsage) => void;
      const stalePromise = new Promise<typeof mockDailyUsage>((r) => { resolveStale = r; });
      const newerUsage = { ...mockDailyUsage, estimatedCostUsd: 99.99 };

      tokensMock.getDailyUsage
        .mockImplementationOnce(() => stalePromise)
        .mockResolvedValueOnce(newerUsage);

      const stale = useStatsStore.getState().setSelectedDate('2025-03-10');
      const newer = useStatsStore.getState().setSelectedDate('2025-03-15');
      await newer;

      expect(useStatsStore.getState().dailyUsage?.estimatedCostUsd).toBe(99.99);

      // Now release the stale call — its result must be dropped, not applied.
      resolveStale(mockDailyUsage);
      await stale;

      expect(useStatsStore.getState().dailyUsage?.estimatedCostUsd).toBe(99.99);
      expect(useStatsStore.getState().selectedDate).toBe('2025-03-15');
    });
  });
});
