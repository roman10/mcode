import { vi } from 'vitest';

/**
 * Reusable mock for the window.mcode bridge in renderer tests.
 * Stubs all common IPC methods with basic mock implementations.
 */
export function setupMcodeMock(overrides: Record<string, any> = {}) {
  const mcode = {
    app: {
      getPlatform: vi.fn().mockReturnValue('darwin'),
      getHomeDir: vi.fn().mockReturnValue('/home/user'),
      getVersion: vi.fn().mockReturnValue('0.0.0-test'),
    },
    layout: {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(null),
    },
    preferences: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    sessions: {
      list: vi.fn().mockResolvedValue([]),
      listExternal: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ sessionId: 'new-sess' }),
      kill: vi.fn().mockResolvedValue(undefined),
      clearAttention: vi.fn().mockResolvedValue(undefined),
      onUpdated: vi.fn(() => vi.fn()),
      onCreated: vi.fn(() => vi.fn()),
      onDeleted: vi.fn(() => vi.fn()),
      onDeletedBatch: vi.fn(() => vi.fn()),
    },
    hooks: {
      getRuntime: vi.fn().mockResolvedValue({ state: 'initializing', port: null, warning: null }),
    },
    tasks: {
      list: vi.fn().mockResolvedValue([]),
      onChanged: vi.fn(() => vi.fn()),
    },
    pty: {
      onExit: vi.fn(() => vi.fn()),
    },
    search: {
      onEvent: vi.fn(() => vi.fn()),
    },
    tokens: {
      getDailyUsage: vi.fn().mockResolvedValue(null),
      getHeatmap: vi.fn().mockResolvedValue([]),
      getWeeklyTrend: vi.fn().mockResolvedValue(null),
    },
    commits: {
      getDailyStats: vi.fn().mockResolvedValue(null),
      getHeatmap: vi.fn().mockResolvedValue([]),
      getStreaks: vi.fn().mockResolvedValue(null),
      getCadence: vi.fn().mockResolvedValue(null),
      getWeeklyTrend: vi.fn().mockResolvedValue(null),
    },
    input: {
      getDailyStats: vi.fn().mockResolvedValue(null),
      getHeatmap: vi.fn().mockResolvedValue([]),
      getWeeklyTrend: vi.fn().mockResolvedValue(null),
      getCadence: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  };

  vi.stubGlobal('window', { mcode });
  return mcode;
}
