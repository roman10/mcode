import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockDailyUsage = {
  date: '2025-03-25',
  estimatedCostUsd: 2.14,
  messageCount: 84,
  totals: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 },
  byModel: [],
  topSessions: [],
};

const mockTokenHeatmap = [{ date: '2025-03-25', estimatedCostUsd: 2.14, messageCount: 84, outputTokens: 500 }];
const mockTokenWeeklyTrend = { thisWeek: { estimatedCostUsd: 10 }, lastWeek: { estimatedCostUsd: 8 }, pctChange: 25 };

const mockDailyStats = {
  date: '2025-03-25',
  total: 5,
  totalInsertions: 120,
  totalDeletions: 30,
  claudeAssisted: 4,
  soloCount: 1,
  byRepo: [],
  byType: [],
};

const mockCommitHeatmap = [{ date: '2025-03-25', count: 5, insertions: 120 }];
const mockStreaks = { current: 3, longest: 10 };
const mockCadence = { avgMinutes: 45, peakHour: '14', commitsByHour: {} };
const mockCommitWeeklyTrend = { thisWeek: 5, lastWeek: 3, pctChange: 67 };

const mockDailyInputStats = {
  date: '2025-03-25',
  total: 12,
  byType: [],
};

const mockInputHeatmap = [{ date: '2025-03-25', count: 12 }];
const mockInputWeeklyTrend = { thisWeek: 12, lastWeek: 8, pctChange: 50 };
const mockInputCadence = { avgMinutes: 30, peakHour: '10', inputsByHour: {} };

// ── Mocks ─────────────────────────────────────────────────────────────────────

const tokensMock = {
  getDailyUsage: vi.fn().mockResolvedValue(mockDailyUsage),
  getHeatmap: vi.fn().mockResolvedValue(mockTokenHeatmap),
  getWeeklyTrend: vi.fn().mockResolvedValue(mockTokenWeeklyTrend),
};

const commitsMock = {
  getDailyStats: vi.fn().mockResolvedValue(mockDailyStats),
  getHeatmap: vi.fn().mockResolvedValue(mockCommitHeatmap),
  getStreaks: vi.fn().mockResolvedValue(mockStreaks),
  getCadence: vi.fn().mockResolvedValue(mockCadence),
  getWeeklyTrend: vi.fn().mockResolvedValue(mockCommitWeeklyTrend),
};

const inputMock = {
  getDailyStats: vi.fn().mockResolvedValue(mockDailyInputStats),
  getHeatmap: vi.fn().mockResolvedValue(mockInputHeatmap),
  getWeeklyTrend: vi.fn().mockResolvedValue(mockInputWeeklyTrend),
  getCadence: vi.fn().mockResolvedValue(mockInputCadence),
};

vi.stubGlobal('window', { mcode: { tokens: tokensMock, commits: commitsMock, input: inputMock } });

const { useStatsStore } = await import('../../../../src/renderer/stores/stats-store');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('stats-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStatsStore.setState({
      dailyUsage: null,
      tokenHeatmap: [],
      tokenWeeklyTrend: null,
      dailyStats: null,
      commitHeatmap: [],
      streaks: null,
      cadence: null,
      commitWeeklyTrend: null,
      dailyInputStats: null,
      inputHeatmap: [],
      inputWeeklyTrend: null,
      inputCadence: null,
      loading: false,
      selectedDate: null,
    });
  });

  describe('initial state', () => {
    it('has correct null/empty initial values', () => {
      const state = useStatsStore.getState();
      expect(state.dailyUsage).toBeNull();
      expect(state.tokenHeatmap).toEqual([]);
      expect(state.tokenWeeklyTrend).toBeNull();
      expect(state.dailyStats).toBeNull();
      expect(state.commitHeatmap).toEqual([]);
      expect(state.streaks).toBeNull();
      expect(state.cadence).toBeNull();
      expect(state.commitWeeklyTrend).toBeNull();
      expect(state.dailyInputStats).toBeNull();
      expect(state.inputHeatmap).toEqual([]);
      expect(state.inputWeeklyTrend).toBeNull();
      expect(state.inputCadence).toBeNull();
      expect(state.loading).toBe(false);
      expect(state.selectedDate).toBeNull();
    });
  });

  describe('refreshAll', () => {
    it('fetches all 12 IPC calls and populates state', async () => {
      await useStatsStore.getState().refreshAll();

      expect(tokensMock.getDailyUsage).toHaveBeenCalledWith(undefined);
      expect(tokensMock.getHeatmap).toHaveBeenCalledWith(90);
      expect(tokensMock.getWeeklyTrend).toHaveBeenCalledOnce();
      expect(commitsMock.getDailyStats).toHaveBeenCalledWith(undefined);
      expect(commitsMock.getHeatmap).toHaveBeenCalledWith(90);
      expect(commitsMock.getStreaks).toHaveBeenCalledOnce();
      expect(commitsMock.getCadence).toHaveBeenCalledWith(undefined);
      expect(commitsMock.getWeeklyTrend).toHaveBeenCalledOnce();
      expect(inputMock.getDailyStats).toHaveBeenCalledWith(undefined);
      expect(inputMock.getHeatmap).toHaveBeenCalledWith(90);
      expect(inputMock.getWeeklyTrend).toHaveBeenCalledOnce();
      expect(inputMock.getCadence).toHaveBeenCalledWith(undefined);

      const state = useStatsStore.getState();
      expect(state.dailyUsage).toEqual(mockDailyUsage);
      expect(state.tokenHeatmap).toEqual(mockTokenHeatmap);
      expect(state.tokenWeeklyTrend).toEqual(mockTokenWeeklyTrend);
      expect(state.dailyStats).toEqual(mockDailyStats);
      expect(state.commitHeatmap).toEqual(mockCommitHeatmap);
      expect(state.streaks).toEqual(mockStreaks);
      expect(state.cadence).toEqual(mockCadence);
      expect(state.commitWeeklyTrend).toEqual(mockCommitWeeklyTrend);
      expect(state.dailyInputStats).toEqual(mockDailyInputStats);
      expect(state.inputHeatmap).toEqual(mockInputHeatmap);
      expect(state.inputWeeklyTrend).toEqual(mockInputWeeklyTrend);
      expect(state.inputCadence).toEqual(mockInputCadence);
      expect(state.loading).toBe(false);
    });

    it('passes selectedDate to date-specific IPC calls', async () => {
      useStatsStore.setState({ selectedDate: '2025-03-20' });
      await useStatsStore.getState().refreshAll();

      expect(tokensMock.getDailyUsage).toHaveBeenCalledWith('2025-03-20');
      expect(commitsMock.getDailyStats).toHaveBeenCalledWith('2025-03-20');
      expect(commitsMock.getCadence).toHaveBeenCalledWith('2025-03-20');
      expect(inputMock.getDailyStats).toHaveBeenCalledWith('2025-03-20');
      expect(inputMock.getCadence).toHaveBeenCalledWith('2025-03-20');
    });

    it('sets loading: false on error and does not crash', async () => {
      tokensMock.getDailyUsage.mockRejectedValueOnce(new Error('IPC error'));

      await useStatsStore.getState().refreshAll();

      expect(useStatsStore.getState().loading).toBe(false);
    });
  });

  describe('setSelectedDate', () => {
    it('updates selectedDate and triggers refreshAll', async () => {
      await useStatsStore.getState().setSelectedDate('2025-03-10');

      expect(useStatsStore.getState().selectedDate).toBe('2025-03-10');
      expect(tokensMock.getDailyUsage).toHaveBeenCalledWith('2025-03-10');
      expect(commitsMock.getDailyStats).toHaveBeenCalledWith('2025-03-10');
      expect(inputMock.getDailyStats).toHaveBeenCalledWith('2025-03-10');
    });

    it('accepts null (= today) and passes undefined to date-specific calls', async () => {
      useStatsStore.setState({ selectedDate: '2025-03-10' });
      await useStatsStore.getState().setSelectedDate(null);

      expect(useStatsStore.getState().selectedDate).toBeNull();
      expect(tokensMock.getDailyUsage).toHaveBeenCalledWith(undefined);
    });
  });
});
