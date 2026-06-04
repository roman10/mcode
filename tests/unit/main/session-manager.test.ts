import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from '../../../src/main/session/session-manager';
import { getDb, resetDbForTest } from '../../../src/main/db';
import { truncateTestData } from '../db-helpers';
import type { IObservablePtyManager } from '../../../src/shared/pty-manager-interface';
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
    const ptyStub = new EventEmitter() as unknown as IObservablePtyManager;
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

  it('does not force-flush pending session:updated when sending a hook event', async () => {
    insertSession('s1');

    manager.broadcastSessionUpdate('s1');
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
    (manager as unknown as {
      broadcaster: { broadcastHookEvent: (e: HookEvent) => void };
    }).broadcaster.broadcastHookEvent(event);

    // hook:event sends immediately; session:updated stays queued so bursts of
    // hook events during tool use coalesce into a single broadcast per tick.
    expect(sent.map((m) => m.channel)).toEqual(['hook:event']);
    await tick();
    expect(sent.map((m) => m.channel)).toEqual(['hook:event', 'session:updated']);
  });

  it('skips sending for ids whose session has been deleted before flush', async () => {
    insertSession('s1');

    manager.broadcastSessionUpdate('s1');
    getDb().prepare('DELETE FROM sessions WHERE session_id = ?').run('s1');

    await tick();

    expect(sent.filter((m) => m.channel === 'session:updated')).toHaveLength(0);
  });
});

describe('SessionManager Claude transcript refresh coalescing', () => {
  let manager: SessionManager;
  let tempDir: string;
  const fakeWc = {
    send: vi.fn(),
    isDestroyed: () => false,
  };

  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(async () => {
    truncateTestData(getDb());
    vi.useFakeTimers();
    fakeWc.send.mockReset();
    tempDir = await mkdtemp(join(tmpdir(), 'mcode-session-manager-'));
    const ptyStub = new EventEmitter() as unknown as IObservablePtyManager;
    const accountStub = {} as unknown as AccountService;
    const hookRuntime: HookRuntimeInfo = { state: 'ready', port: 1234, warning: null };
    manager = new SessionManager(
      ptyStub,
      () => fakeWc as unknown as Electron.WebContents,
      () => hookRuntime,
      accountStub,
    );
  });

  afterEach(async () => {
    manager.shutdownDetection();
    vi.useRealTimers();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('coalesces repeated hook-triggered Claude transcript refreshes', async () => {
    // Real timers: schedule's setTimeout(0) + the refresher's real fs.stat
    // don't play nicely with vi.runAllTimersAsync under parallel load.
    vi.useRealTimers();

    const transcriptPath = join(tempDir, 'claude.jsonl');
    await writeFile(transcriptPath, '{"message":{"model":"claude-sonnet-4-5"}}\n');
    const updateSpy = vi
      .spyOn(manager, 'updateModelFromTranscript')
      .mockResolvedValue(undefined);
    const refresher = (manager as unknown as {
      transcriptRefresher: { schedule(sessionId: string, path: string, delay: number): void };
    }).transcriptRefresher;

    refresher.schedule('s1', transcriptPath, 0);
    refresher.schedule('s1', transcriptPath, 0);
    refresher.schedule('s1', transcriptPath, 0);

    await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith('s1', transcriptPath);
  });

  // Note: the "skips rereading an unchanged transcript" freshness-cache test
  // lives in claude-transcript-refresher.test.ts now — the cache survives only
  // within an in-flight burst, which is awkward to exercise through
  // SessionManager's coarser scheduling surface.
});

/**
 * Codex emits its thread id as `session_id` in every hook event (the hook
 * server lands it on event.claudeSessionId). handleHookEvent must persist it to
 * the codex_thread_id column so the session is resumable — the deterministic
 * replacement for the flaky sqlite-poll heuristic.
 */
describe('SessionManager Codex thread id capture from hook', () => {
  let manager: SessionManager;
  const fakeWc = { send: vi.fn(), isDestroyed: () => false };

  beforeAll(() => resetDbForTest());
  afterAll(() => resetDbForTest());

  beforeEach(() => {
    truncateTestData(getDb());
    fakeWc.send.mockReset();
    const ptyStub = new EventEmitter() as unknown as IObservablePtyManager;
    const accountStub = {} as unknown as AccountService;
    const hookRuntime: HookRuntimeInfo = { state: 'ready', port: 1234, warning: null };
    manager = new SessionManager(
      ptyStub,
      () => fakeWc as unknown as Electron.WebContents,
      () => hookRuntime,
      accountStub,
    );
  });

  function codexStartEvent(threadId: string): HookEvent {
    return {
      sessionId: 'cdx',
      claudeSessionId: threadId,
      hookEventName: 'SessionStart',
      sessionStatus: null,
      toolName: null,
      toolInput: null,
      payload: { session_id: threadId, hook_event_name: 'SessionStart' },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
  }

  function readThreadId(sessionId: string): string | null {
    const row = getDb()
      .prepare('SELECT codex_thread_id FROM sessions WHERE session_id = ?')
      .get(sessionId) as { codex_thread_id: string | null } | undefined;
    return row?.codex_thread_id ?? null;
  }

  it('records codex_thread_id from the SessionStart hook session_id', () => {
    insertSession('cdx', { session_type: 'codex', codex_thread_id: null });

    const type = manager.handleHookEvent('cdx', codexStartEvent('019e8fee-thread'));

    expect(type).toBe('codex');
    expect(readThreadId('cdx')).toBe('019e8fee-thread');
  });

  it('does not overwrite an already-recorded codex_thread_id', () => {
    insertSession('cdx', { session_type: 'codex', codex_thread_id: 'first-thread' });

    manager.handleHookEvent('cdx', codexStartEvent('second-thread'));

    expect(readThreadId('cdx')).toBe('first-thread');
  });

  it('does not route the codex thread id into the claude column', () => {
    insertSession('cdx', { session_type: 'codex', codex_thread_id: null });

    manager.handleHookEvent('cdx', codexStartEvent('019e8fee-thread'));

    const row = getDb()
      .prepare('SELECT claude_session_id FROM sessions WHERE session_id = ?')
      .get('cdx') as { claude_session_id: string | null };
    expect(row.claude_session_id).toBeNull();
  });
});
