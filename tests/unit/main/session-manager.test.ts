import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { SessionManager } from '../../../src/main/session/session-manager';
import { getDb, resetDbForTest } from '../../../src/main/db';
import { truncateTestData } from '../db-helpers';
import type { IPtyManager } from '../../../src/shared/pty-manager-interface';
import type { AccountService } from '../../../src/main/accounts';
import type { HookEvent, HookRuntimeInfo } from '../../../src/shared/types';

/**
 * Exercises the outbound session:updated coalescer: repeated broadcast calls
 * within a tick must collapse into one IPC send per session carrying the
 * latest snapshot, and pending broadcasts must flush synchronously before any
 * hook:event send so the renderer never observes the hook before the state.
 */

vi.mock('../../../src/main/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function insertSession(sessionId: string, overrides: Record<string, unknown> = {}): void {
  const defaults = {
    label: `test-${sessionId}`,
    label_source: 'auto',
    cwd: '/tmp/test',
    status: 'active',
    started_at: '2026-01-01T00:00:00.000Z',
    session_type: 'claude',
    hook_mode: 'live',
    terminal_config: '{}',
    attention_level: 'none',
    auto_close: 0,
    is_test: 1,
  };
  const merged = { ...defaults, ...overrides };
  const cols = ['session_id', ...Object.keys(merged)];
  const vals = [sessionId, ...Object.values(merged)];
  const placeholders = cols.map(() => '?').join(', ');
  getDb().prepare(`INSERT INTO sessions (${cols.join(', ')}) VALUES (${placeholders})`).run(vals);
}

function setAttention(sessionId: string, level: 'none' | 'info' | 'action'): void {
  getDb().prepare('UPDATE sessions SET attention_level = ? WHERE session_id = ?').run(level, sessionId);
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('SessionManager broadcast coalescing', () => {
  let manager: SessionManager;
  let sent: Array<{ channel: string; payload: unknown }>;
  const fakeWc = {
    send: (channel: string, payload: unknown) => {
      sent.push({ channel, payload });
    },
    isDestroyed: () => false,
  };

  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    truncateTestData(getDb());
    sent = [];
    const ptyStub = {} as unknown as IPtyManager;
    const accountStub = {} as unknown as AccountService;
    const hookRuntime: HookRuntimeInfo = { state: 'ready', port: 1234, warning: null };
    manager = new SessionManager(
      ptyStub,
      () => fakeWc as unknown as Electron.WebContents,
      () => hookRuntime,
      accountStub,
    );
  });

  it('coalesces repeat broadcasts for one session into a single send per tick', async () => {
    insertSession('s1', { attention_level: 'none' });

    manager.broadcastSessionUpdate('s1');
    manager.broadcastSessionUpdate('s1');
    manager.broadcastSessionUpdate('s1');

    expect(sent).toHaveLength(0); // deferred

    await tick();

    const updates = sent.filter((m) => m.channel === 'session:updated');
    expect(updates).toHaveLength(1);
  });

  it('sends the latest snapshot when state mutates between broadcast calls', async () => {
    insertSession('s1', { attention_level: 'none' });

    manager.broadcastSessionUpdate('s1');
    setAttention('s1', 'action');
    manager.broadcastSessionUpdate('s1');

    await tick();

    const updates = sent.filter((m) => m.channel === 'session:updated');
    expect(updates).toHaveLength(1);
    expect((updates[0].payload as { attentionLevel: string }).attentionLevel).toBe('action');
  });

  it('sends one update per session id when multiple sessions are enqueued', async () => {
    insertSession('s1');
    insertSession('s2');
    insertSession('s3');

    manager.broadcastSessionUpdate('s1');
    manager.broadcastSessionUpdate('s2');
    manager.broadcastSessionUpdate('s1');
    manager.broadcastSessionUpdate('s3');
    manager.broadcastSessionUpdate('s2');

    await tick();

    const ids = sent
      .filter((m) => m.channel === 'session:updated')
      .map((m) => (m.payload as { sessionId: string }).sessionId)
      .sort();
    expect(ids).toEqual(['s1', 's2', 's3']);
  });

  it('fires onSessionsChanged once per flushed tick, not once per enqueue', async () => {
    insertSession('s1');
    insertSession('s2');
    const listener = vi.fn();
    manager.onSessionsChanged(listener);

    manager.broadcastSessionUpdate('s1');
    manager.broadcastSessionUpdate('s2');
    manager.broadcastSessionUpdate('s1');

    expect(listener).not.toHaveBeenCalled();
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('flushes pending broadcasts before a hook event so renderer ordering is preserved', async () => {
    insertSession('s1');

    manager.broadcastSessionUpdate('s1');
    // Access the private method via index signature — this exercises the exact
    // code path real callers (e.g. handleHookEvent) take.
    const event: HookEvent = {
      sessionId: 's1',
      claudeSessionId: null,
      hookEventName: 'Stop',
      sessionStatus: 'idle',
      toolName: null,
      toolInput: null,
      payload: {},
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    (manager as unknown as { broadcastHookEvent: (e: HookEvent) => void }).broadcastHookEvent(event);

    // No await here — the flush must have happened synchronously.
    expect(sent.map((m) => m.channel)).toEqual(['session:updated', 'hook:event']);
  });

  it('skips sending for ids whose session has been deleted before flush', async () => {
    insertSession('s1');

    manager.broadcastSessionUpdate('s1');
    getDb().prepare('DELETE FROM sessions WHERE session_id = ?').run('s1');

    await tick();

    expect(sent.filter((m) => m.channel === 'session:updated')).toHaveLength(0);
  });
});
