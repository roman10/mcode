import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupMcodeMock } from '../mock-mcode';
import { useSessionStore } from '../../../../src/renderer/stores/session-store';
import type { SessionInfo } from '../../../../src/shared/types';

const mcode = setupMcodeMock();
const mockClearAttention = mcode.sessions.clearAttention;

function makeSession(id: string): SessionInfo {
  return {
    sessionId: id,
    label: `Session ${id}`,
    cwd: '/tmp',
    status: 'active',
    startedAt: new Date().toISOString(),
    endedAt: null,
    claudeSessionId: null,
    codexThreadId: null,
    geminiSessionId: null,
    lastTool: null,
    lastEventAt: null,
    attentionLevel: 'none',
    attentionReason: null,
    hookMode: 'live',
    sessionType: 'claude',
    terminalConfig: {},
    accountId: null,
    autoClose: false,
    model: null,
  };
}

describe('session-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      sessions: {},
      externalSessions: [],
      selectedSessionId: null,
      lastFocusedPtySessionId: null,
      hookRuntime: { state: 'initializing', port: null, warning: null },
      exitCodes: {},
    });
  });

  it('addSession adds a new session to the store', () => {
    const s1 = makeSession('s1');
    useSessionStore.getState().addSession(s1);
    expect(useSessionStore.getState().sessions['s1']).toEqual(s1);
  });

  it('upsertSession updates an existing session', () => {
    const s1 = makeSession('s1');
    useSessionStore.getState().addSession(s1);
    
    const updatedS1 = { ...s1, label: 'Updated Label' };
    useSessionStore.getState().upsertSession(updatedS1);
    
    expect(useSessionStore.getState().sessions['s1'].label).toBe('Updated Label');
  });

  it('removeSession removes session and its exit code', () => {
    const s1 = makeSession('s1');
    useSessionStore.getState().addSession(s1);
    useSessionStore.getState().setExitCode('s1', 0);
    useSessionStore.setState({ selectedSessionId: 's1' });

    useSessionStore.getState().removeSession('s1');

    expect(useSessionStore.getState().sessions['s1']).toBeUndefined();
    expect(useSessionStore.getState().exitCodes['s1']).toBeUndefined();
    expect(useSessionStore.getState().selectedSessionId).toBeNull();
  });

  it('removeSession clears lastFocusedPtySessionId when it matches', () => {
    useSessionStore.getState().addSession(makeSession('s1'));
    useSessionStore.setState({ lastFocusedPtySessionId: 's1' });

    useSessionStore.getState().removeSession('s1');

    expect(useSessionStore.getState().lastFocusedPtySessionId).toBeNull();
  });

  it('removeSession preserves lastFocusedPtySessionId when it points elsewhere', () => {
    useSessionStore.getState().addSession(makeSession('s1'));
    useSessionStore.setState({ lastFocusedPtySessionId: 's2' });

    useSessionStore.getState().removeSession('s1');

    expect(useSessionStore.getState().lastFocusedPtySessionId).toBe('s2');
  });

  it('selectSession sets selectedSessionId and clears attention for user source', () => {
    useSessionStore.getState().selectSession('s1', 'user');
    expect(useSessionStore.getState().selectedSessionId).toBe('s1');
    expect(mockClearAttention).toHaveBeenCalledWith('s1');
  });

  it('selectSession does not clear attention for system source', () => {
    useSessionStore.getState().selectSession('s1', 'system');
    expect(useSessionStore.getState().selectedSessionId).toBe('s1');
    expect(mockClearAttention).not.toHaveBeenCalled();
  });

  it('selectSession updates lastFocusedPtySessionId when id is non-null', () => {
    useSessionStore.getState().selectSession('s1', 'user');
    expect(useSessionStore.getState().lastFocusedPtySessionId).toBe('s1');

    useSessionStore.getState().selectSession('s2', 'user');
    expect(useSessionStore.getState().lastFocusedPtySessionId).toBe('s2');
  });

  it('selectSession(null) preserves lastFocusedPtySessionId', () => {
    // A bottom-panel terminal could be the current pty target even if the tile
    // selection gets cleared — don't clobber pty routing on null selects.
    useSessionStore.setState({ lastFocusedPtySessionId: 'panel-sess' });

    useSessionStore.getState().selectSession(null);

    expect(useSessionStore.getState().selectedSessionId).toBeNull();
    expect(useSessionStore.getState().lastFocusedPtySessionId).toBe('panel-sess');
  });

  it('setLastFocusedPtySession sets the field independently of selectedSessionId', () => {
    useSessionStore.setState({ selectedSessionId: 'tile-sess' });

    useSessionStore.getState().setLastFocusedPtySession('panel-sess');

    expect(useSessionStore.getState().lastFocusedPtySessionId).toBe('panel-sess');
    expect(useSessionStore.getState().selectedSessionId).toBe('tile-sess');
  });

  it('setLabel updates session label if it exists', () => {
    const s1 = makeSession('s1');
    useSessionStore.getState().addSession(s1);
    
    useSessionStore.getState().setLabel('s1', 'New Name');
    expect(useSessionStore.getState().sessions['s1'].label).toBe('New Name');
  });

  it('setSessions replaces all sessions', () => {
    const s1 = makeSession('s1');
    const s2 = makeSession('s2');
    useSessionStore.getState().setSessions([s1, s2]);
    
    expect(Object.keys(useSessionStore.getState().sessions)).toHaveLength(2);
    expect(useSessionStore.getState().sessions['s1']).toBeDefined();
    expect(useSessionStore.getState().sessions['s2']).toBeDefined();
  });

  it('setExitCode updates exit code for a session', () => {
    useSessionStore.getState().setExitCode('s1', 1);
    expect(useSessionStore.getState().exitCodes['s1']).toBe(1);
  });
});
