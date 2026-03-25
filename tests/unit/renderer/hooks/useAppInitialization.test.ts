import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionInfo, HookRuntimeInfo, Task } from '../../../../src/shared/types';

// --- Mocks ---

const mockSetSessions = vi.fn();
const mockSetHookRuntime = vi.fn();
const mockSetTasks = vi.fn();
const mockSetExternalSessions = vi.fn();
const mockRestore = vi.fn().mockResolvedValue(undefined);
const mockPruneTiles = vi.fn();
const mockStripFileTiles = vi.fn();
const mockPersist = vi.fn();
const mockRemoveTile = vi.fn();
const mockEditorLoad = vi.fn().mockResolvedValue(undefined);
const mockAccountsRefresh = vi.fn().mockResolvedValue(undefined);
const mockAccountsRefreshCli = vi.fn().mockResolvedValue(undefined);
const mockAddTerminal = vi.fn();

vi.mock('../../../../src/renderer/stores/session-store', () => ({
  useSessionStore: {
    getState: vi.fn(() => ({
      setSessions: mockSetSessions,
      setHookRuntime: mockSetHookRuntime,
      setExternalSessions: mockSetExternalSessions,
      sessions: {},
    })),
  },
}));

vi.mock('../../../../src/renderer/stores/layout-store', () => ({
  useLayoutStore: {
    getState: vi.fn(() => ({
      restore: mockRestore,
      pruneTiles: mockPruneTiles,
      stripFileTiles: mockStripFileTiles,
      mosaicTree: null,
      persist: mockPersist,
      removeTile: mockRemoveTile,
    })),
  },
}));

vi.mock('../../../../src/renderer/stores/task-store', () => ({
  useTaskStore: {
    getState: vi.fn(() => ({
      setTasks: mockSetTasks,
    })),
  },
}));

vi.mock('../../../../src/renderer/stores/editor-store', () => ({
  useEditorStore: {
    getState: vi.fn(() => ({ load: mockEditorLoad })),
  },
}));

vi.mock('../../../../src/renderer/stores/accounts-store', () => ({
  useAccountsStore: {
    getState: vi.fn(() => ({
      refresh: mockAccountsRefresh,
      refreshCliStatus: mockAccountsRefreshCli,
    })),
  },
}));

vi.mock('../../../../src/renderer/stores/terminal-panel-store', () => ({
  useTerminalPanelStore: {
    getState: vi.fn(() => ({ addTerminal: mockAddTerminal })),
  },
}));

const mockRuntime: HookRuntimeInfo = { state: 'live', port: 8080, warning: null };
const mockSessions: SessionInfo[] = [];
const mockTasks: Task[] = [];

vi.stubGlobal('window', {
  mcode: {
    sessions: {
      list: vi.fn().mockResolvedValue(mockSessions),
      listExternal: vi.fn().mockResolvedValue([]),
    },
    hooks: { getRuntime: vi.fn().mockResolvedValue(mockRuntime) },
    tasks: { list: vi.fn().mockResolvedValue(mockTasks) },
    preferences: { get: vi.fn().mockResolvedValue(null) },
  },
});

const { loadInitialData } = await import('../../../../src/renderer/hooks/useAppInitialization');

describe('loadInitialData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRestore.mockResolvedValue(undefined);
    mockEditorLoad.mockResolvedValue(undefined);
    mockAccountsRefresh.mockResolvedValue(undefined);
    mockAccountsRefreshCli.mockResolvedValue(undefined);
    (window.mcode.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockSessions);
    (window.mcode.sessions.listExternal as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (window.mcode.hooks.getRuntime as ReturnType<typeof vi.fn>).mockResolvedValue(mockRuntime);
    (window.mcode.tasks.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockTasks);
  });

  it('loads sessions from main process and stores them', async () => {
    const sessions: SessionInfo[] = [
      { sessionId: 's1', label: 'Test', status: 'running', sessionType: 'claude' } as SessionInfo,
    ];
    (window.mcode.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue(sessions);

    await loadInitialData({ cancelled: false });

    expect(window.mcode.sessions.list).toHaveBeenCalledOnce();
    expect(mockSetSessions).toHaveBeenCalledWith(sessions);
  });

  it('loads hook runtime and stores it', async () => {
    await loadInitialData({ cancelled: false });

    expect(window.mcode.hooks.getRuntime).toHaveBeenCalledOnce();
    expect(mockSetHookRuntime).toHaveBeenCalledWith(mockRuntime);
  });

  it('restores layout after loading sessions', async () => {
    await loadInitialData({ cancelled: false });

    expect(mockRestore).toHaveBeenCalledOnce();
  });

  it('loads tasks and stores them', async () => {
    const tasks: Task[] = [{ id: 1, prompt: 'Do something' } as Task];
    (window.mcode.tasks.list as ReturnType<typeof vi.fn>).mockResolvedValue(tasks);

    await loadInitialData({ cancelled: false });

    expect(window.mcode.tasks.list).toHaveBeenCalledOnce();
    expect(mockSetTasks).toHaveBeenCalledWith(tasks);
  });

  it('does not set sessions when cancelled before sessions.list resolves', async () => {
    let resolveList: (v: SessionInfo[]) => void = () => {};
    (window.mcode.sessions.list as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((r) => { resolveList = r; }),
    );

    const signal = { cancelled: false };
    const promise = loadInitialData(signal);

    signal.cancelled = true;
    resolveList([]);

    await promise;

    expect(mockSetSessions).not.toHaveBeenCalled();
    expect(window.mcode.hooks.getRuntime).not.toHaveBeenCalled();
  });

  it('does not set tasks when cancelled before tasks.list resolves', async () => {
    let resolveTasks: (v: Task[]) => void = () => {};
    (window.mcode.tasks.list as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((r) => { resolveTasks = r; }),
    );

    const signal = { cancelled: false };
    const promise = loadInitialData(signal);

    // Let sessions/runtime/restore complete, then cancel before tasks
    await new Promise((r) => setTimeout(r, 0));
    signal.cancelled = true;
    resolveTasks([]);

    await promise;

    expect(mockSetTasks).not.toHaveBeenCalled();
  });

  it('prunes tiles and strips file tiles after restore', async () => {
    const sessions: SessionInfo[] = [
      { sessionId: 's1' } as SessionInfo,
    ];
    (window.mcode.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue(sessions);

    await loadInitialData({ cancelled: false });

    expect(mockPruneTiles).toHaveBeenCalledWith(new Set(['s1']));
    expect(mockStripFileTiles).toHaveBeenCalledOnce();
  });

  it('loads editor preferences', async () => {
    await loadInitialData({ cancelled: false });

    expect(mockEditorLoad).toHaveBeenCalledOnce();
  });

  it('kicks off non-blocking accounts refresh', async () => {
    await loadInitialData({ cancelled: false });

    expect(mockAccountsRefresh).toHaveBeenCalledOnce();
    expect(mockAccountsRefreshCli).toHaveBeenCalledOnce();
  });
});
