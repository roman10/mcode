import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock fns ---

const mockUpsertSession = vi.fn();
const mockAddSession = vi.fn();
const mockRemoveSession = vi.fn();
const mockRemoveTile = vi.fn();
const mockAddTile = vi.fn();
const mockPersist = vi.fn();
const mockUpsertTask = vi.fn();
const mockRemoveTask = vi.fn();
const mockRefreshTasks = vi.fn();
const mockRemoveTerminal = vi.fn();
const mockAddTerminal = vi.fn();
const mockSetExitCode = vi.fn();
const mockHandleSearchEvent = vi.fn();

// Track sessions in a mutable object so the onUpdated callback
// can read prevStatus via useSessionStore.getState().sessions
const sessionsState: Record<string, { status: string }> = {};

// --- Mock stores ---

vi.mock('../../../../src/renderer/stores/session-store', () => {
  const store = vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      upsertSession: mockUpsertSession,
      addSession: mockAddSession,
      removeSession: mockRemoveSession,
    }),
  );
  (store as unknown as Record<string, unknown>).getState = vi.fn(() => ({
    sessions: sessionsState,
    setExitCode: mockSetExitCode,
  }));
  return { useSessionStore: store };
});

vi.mock('../../../../src/renderer/stores/layout-store', () => ({
  useLayoutStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      removeTile: mockRemoveTile,
      addTile: mockAddTile,
      persist: mockPersist,
    }),
  ),
}));

vi.mock('../../../../src/renderer/stores/task-store', () => ({
  useTaskStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      upsertTask: mockUpsertTask,
      removeTask: mockRemoveTask,
      refreshTasks: mockRefreshTasks,
    }),
  ),
}));

vi.mock('../../../../src/renderer/stores/terminal-panel-store', () => ({
  useTerminalPanelStore: {
    getState: vi.fn(() => ({
      removeTerminal: mockRemoveTerminal,
      addTerminal: mockAddTerminal,
    })),
  },
}));

vi.mock('../../../../src/renderer/stores/search-store', () => ({
  useSearchStore: {
    getState: vi.fn(() => ({
      handleEvent: mockHandleSearchEvent,
    })),
  },
}));

vi.mock('../../../../src/renderer/utils/path-utils', () => ({
  basename: vi.fn((p: string) => p.split('/').pop() ?? p),
}));

// --- Capture IPC subscription callbacks ---

type SessionCallback = (session: Record<string, unknown>) => void;
type SessionIdCallback = (sessionId: string) => void;
type SessionIdsCallback = (sessionIds: string[]) => void;

let onUpdatedCb: SessionCallback | null = null;
let onCreatedCb: SessionCallback | null = null;
let onDeletedCb: SessionIdCallback | null = null;
let onDeletedBatchCb: SessionIdsCallback | null = null;

vi.stubGlobal('window', {
  mcode: {
    sessions: {
      onUpdated: vi.fn((cb: SessionCallback) => { onUpdatedCb = cb; return vi.fn(); }),
      onCreated: vi.fn((cb: SessionCallback) => { onCreatedCb = cb; return vi.fn(); }),
      onDeleted: vi.fn((cb: SessionIdCallback) => { onDeletedCb = cb; return vi.fn(); }),
      onDeletedBatch: vi.fn((cb: SessionIdsCallback) => { onDeletedBatchCb = cb; return vi.fn(); }),
    },
    pty: {
      onExit: vi.fn(() => vi.fn()),
    },
    tasks: {
      onChanged: vi.fn(() => vi.fn()),
    },
    search: {
      onEvent: vi.fn(() => vi.fn()),
    },
  },
});

vi.stubGlobal('document', { hasFocus: vi.fn(() => true) });
vi.stubGlobal('Notification', { permission: 'default' });

// Mock React — run useEffect callbacks synchronously to capture IPC subscriptions
vi.mock('react', () => ({
  useEffect: vi.fn((cb: () => (() => void) | void) => { cb(); }),
  useRef: vi.fn((initial: unknown) => ({ current: initial })),
}));

const { useSessionSubscriptions } = await import(
  '../../../../src/renderer/hooks/useSessionSubscriptions'
);

describe('useSessionSubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onUpdatedCb = null;
    onCreatedCb = null;
    onDeletedCb = null;
    onDeletedBatchCb = null;
    // Clear sessions state
    for (const key of Object.keys(sessionsState)) delete sessionsState[key];

    // Re-run the hook to register fresh callbacks
    useSessionSubscriptions();
  });

  it('calls removeTerminal on terminal panel when session transitions to ended', () => {
    expect(onUpdatedCb).not.toBeNull();

    // Session was previously active
    sessionsState['s1'] = { status: 'active' };

    // Simulate session update with status 'ended'
    onUpdatedCb!({
      sessionId: 's1',
      status: 'ended',
      attentionLevel: 'none',
    });

    expect(mockRemoveTile).toHaveBeenCalledWith('s1');
    expect(mockRemoveTerminal).toHaveBeenCalledWith('s1');
    expect(mockPersist).toHaveBeenCalled();
  });

  it('does not call removeTerminal when session status is not ended', () => {
    expect(onUpdatedCb).not.toBeNull();

    sessionsState['s1'] = { status: 'starting' };

    onUpdatedCb!({
      sessionId: 's1',
      status: 'active',
      attentionLevel: 'none',
    });

    expect(mockRemoveTile).not.toHaveBeenCalled();
    expect(mockRemoveTerminal).not.toHaveBeenCalled();
  });

  it('does not call removeTerminal when session was already ended', () => {
    expect(onUpdatedCb).not.toBeNull();

    // Session was already ended (duplicate event)
    sessionsState['s1'] = { status: 'ended' };

    onUpdatedCb!({
      sessionId: 's1',
      status: 'ended',
      attentionLevel: 'none',
    });

    expect(mockRemoveTile).not.toHaveBeenCalled();
    expect(mockRemoveTerminal).not.toHaveBeenCalled();
  });
});
