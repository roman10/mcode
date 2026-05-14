import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { SessionManager } from '../../../src/main/session/session-manager';
import { getDb, resetDbForTest } from '../../../src/main/db';
import { truncateTestData } from '../db-helpers';
import type { IObservablePtyManager, PtyInfo } from '../../../src/shared/pty-manager-interface';
import type { AccountService } from '../../../src/main/accounts';
import type { BrokerDiagnostics, HookRuntimeInfo } from '../../../src/shared/types';

vi.mock('../../../src/main/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * Stub PTY manager: extends EventEmitter so SessionManager's
 * pty.data/pty.exit subscriptions wire up cleanly. Buffer + lastDataAt
 * are settable per session for deterministic tests.
 */
class StubPtyManager extends EventEmitter {
  private buffers = new Map<string, string>();
  private lastDataAt = new Map<string, number>();

  setBuffer(id: string, buf: string): void {
    this.buffers.set(id, buf);
  }
  setLastDataAt(id: string, ts: number): void {
    this.lastDataAt.set(id, ts);
  }
  getReplayData(id: string): string {
    return this.buffers.get(id) ?? '';
  }
  getReplayDataTail(id: string, bytes: number): string {
    const buf = this.buffers.get(id) ?? '';
    // Test fixtures are ASCII; char count == byte count.
    return buf.length <= bytes ? buf : buf.slice(-bytes);
  }
  getLastDataAt(id: string): number {
    return this.lastDataAt.get(id) ?? 0;
  }

  // Unused IPtyManager surface — provide stubs to satisfy the type cast.
  spawn(): string {
    throw new Error('not implemented');
  }
  write(): void {}
  resize(): void {}
  async kill(): Promise<void> {}
  async killAll(): Promise<void> {}
  getInfo(): PtyInfo | null {
    return null;
  }
  getDiagnostics(): BrokerDiagnostics {
    return { brokerPid: 0, totalRingBufferBytes: 0, sessions: [] } as unknown as BrokerDiagnostics;
  }
}

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

function getStatus(sessionId: string): { status: string; attention_level: string } | null {
  return (getDb()
    .prepare('SELECT status, attention_level FROM sessions WHERE session_id = ?')
    .get(sessionId) as { status: string; attention_level: string } | undefined) ?? null;
}

describe('SessionManager event-driven detection', () => {
  let manager: SessionManager;
  let pty: StubPtyManager;
  const fakeWc = { send: () => {}, isDestroyed: () => false };

  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    truncateTestData(getDb());
    pty = new StubPtyManager();
    const accountStub = {} as unknown as AccountService;
    const hookRuntime: HookRuntimeInfo = { state: 'ready', port: 1234, warning: null };
    manager = new SessionManager(
      pty as unknown as IObservablePtyManager,
      () => fakeWc as unknown as Electron.WebContents,
      () => hookRuntime,
      accountStub,
    );
  });

  afterEach(() => {
    manager.shutdownDetection();
    vi.useRealTimers();
  });

  it('arms a per-session quiescence timer on pty.data', () => {
    insertSession('s1');
    pty.setBuffer('s1', '');
    pty.setLastDataAt('s1', Date.now());

    pty.emit('pty.data', 's1', '');

    const timers = (manager as unknown as { timers: { quiescenceTimers: Map<string, unknown> } }).timers.quiescenceTimers;
    expect(timers.has('s1')).toBe(true);
  });

  it('clears the prior timer when a new pty.data arrives within the quiescence window', () => {
    insertSession('s1');
    pty.setBuffer('s1', '');
    pty.setLastDataAt('s1', Date.now());

    pty.emit('pty.data', 's1', '');
    const timers = (manager as unknown as { timers: { quiescenceTimers: Map<string, NodeJS.Timeout> } }).timers.quiescenceTimers;
    const first = timers.get('s1');

    pty.emit('pty.data', 's1', '');
    const second = timers.get('s1');

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });

  it('quiescence timer fires detection ~5s after last data and transitions on permission prompt', () => {
    vi.useFakeTimers();
    const start = Date.now();

    insertSession('s1', { status: 'active', attention_level: 'none' });
    // Buffer carries a permission-prompt fixture; last data was just received.
    pty.setBuffer('s1', '\n  Allow once\n  Deny once\n');
    pty.setLastDataAt('s1', start);

    pty.emit('pty.data', 's1', '');

    // Immediate detection runs but isQuiescent is false (just received data),
    // so no transition.
    expect(getStatus('s1')?.status).toBe('active');

    // Advance past PTY_QUIESCENCE_MS + slack so the timer fires.
    vi.advanceTimersByTime(5060);

    const after = getStatus('s1');
    expect(after?.status).toBe('waiting');
    expect(after?.attention_level).toBe('action');
  });

  it('detectSessionState no-ops for sessions in starting status, but timer still arms', () => {
    insertSession('s1', { status: 'starting' });
    pty.setBuffer('s1', '\n  Allow once\n  Deny once\n');
    pty.setLastDataAt('s1', Date.now());

    pty.emit('pty.data', 's1', '');

    // No transition: starting is not pollable.
    expect(getStatus('s1')?.status).toBe('starting');
    // But the timer did arm — guarantees a recheck once status flips to active.
    const timers = (manager as unknown as { timers: { quiescenceTimers: Map<string, unknown> } }).timers.quiescenceTimers;
    expect(timers.has('s1')).toBe(true);
  });

  it('clears the quiescence timer on pty.exit', () => {
    insertSession('s1');
    pty.setBuffer('s1', '');
    pty.setLastDataAt('s1', Date.now());

    pty.emit('pty.data', 's1', '');
    const timers = (manager as unknown as { timers: { quiescenceTimers: Map<string, unknown> } }).timers.quiescenceTimers;
    expect(timers.has('s1')).toBe(true);

    pty.emit('pty.exit', 's1', 0);
    expect(timers.has('s1')).toBe(false);
  });

  it('clears the quiescence timer when delete() runs', () => {
    insertSession('s1', { status: 'active' });
    pty.setBuffer('s1', '');
    pty.setLastDataAt('s1', Date.now());

    pty.emit('pty.data', 's1', '');

    // delete() requires status='ended'.
    getDb().prepare('UPDATE sessions SET status = ? WHERE session_id = ?').run('ended', 's1');
    manager.delete('s1');

    const timers = (manager as unknown as { timers: { quiescenceTimers: Map<string, unknown> } }).timers.quiescenceTimers;
    expect(timers.has('s1')).toBe(false);
  });

  it('shutdownDetection clears all pending timers', () => {
    insertSession('s1');
    insertSession('s2');
    pty.setBuffer('s1', '');
    pty.setBuffer('s2', '');
    pty.setLastDataAt('s1', Date.now());
    pty.setLastDataAt('s2', Date.now());

    pty.emit('pty.data', 's1', '');
    pty.emit('pty.data', 's2', '');

    const timers = (manager as unknown as { timers: { quiescenceTimers: Map<string, unknown> } }).timers.quiescenceTimers;
    expect(timers.size).toBe(2);

    manager.shutdownDetection();
    expect(timers.size).toBe(0);
  });
});
