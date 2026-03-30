import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getDb, resetDbForTest } from '../../../src/main/db';
import { buildModeCycle, calcShiftTabPresses } from '../../../src/main/task-queue';
import type { SessionInfo } from '../../../src/shared/types';

// Minimal SessionInfo factory for testing cycle helpers
function makeSession(opts: {
  permissionMode?: string;
  enableAutoMode?: boolean;
  allowBypassPermissions?: boolean;
} = {}): SessionInfo {
  return {
    sessionId: 'test-session',
    label: 'test',
    cwd: '/tmp',
    status: 'idle',
    permissionMode: opts.permissionMode as SessionInfo['permissionMode'],
    enableAutoMode: opts.enableAutoMode,
    allowBypassPermissions: opts.allowBypassPermissions,
    worktree: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    claudeSessionId: null,
    codexThreadId: null,
    geminiSessionId: null,
    copilotSessionId: null,
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

describe('buildModeCycle', () => {
  it('returns base cycle for a default session', () => {
    const cycle = buildModeCycle(makeSession());
    expect(cycle).toEqual(['default', 'acceptEdits', 'plan']);
  });

  it('includes bypassPermissions when session started with it', () => {
    const cycle = buildModeCycle(makeSession({ permissionMode: 'bypassPermissions' }));
    expect(cycle).toEqual(['default', 'acceptEdits', 'plan', 'bypassPermissions']);
  });

  it('includes bypassPermissions when allowBypassPermissions is set', () => {
    const cycle = buildModeCycle(makeSession({ permissionMode: 'plan', allowBypassPermissions: true }));
    expect(cycle).toEqual(['default', 'acceptEdits', 'plan', 'bypassPermissions']);
  });

  it('includes auto when enableAutoMode is set', () => {
    const cycle = buildModeCycle(makeSession({ enableAutoMode: true }));
    expect(cycle).toEqual(['default', 'acceptEdits', 'plan', 'auto']);
  });

  it('includes both bypassPermissions and auto when both flags set', () => {
    const cycle = buildModeCycle(makeSession({
      permissionMode: 'bypassPermissions',
      enableAutoMode: true,
    }));
    expect(cycle).toEqual(['default', 'acceptEdits', 'plan', 'bypassPermissions', 'auto']);
  });

  it('does not include dontAsk in any configuration', () => {
    const cycle = buildModeCycle(makeSession({
      permissionMode: 'bypassPermissions',
      enableAutoMode: true,
      allowBypassPermissions: true,
    }));
    expect(cycle).not.toContain('dontAsk');
  });
});

describe('calcShiftTabPresses', () => {
  const baseCycle = ['default', 'acceptEdits', 'plan'];
  const fullCycle = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'auto'];

  it('returns 0 when current === target', () => {
    expect(calcShiftTabPresses(baseCycle, 'default', 'default')).toBe(0);
    expect(calcShiftTabPresses(baseCycle, 'plan', 'plan')).toBe(0);
  });

  it('calculates forward presses correctly', () => {
    // default(0) → acceptEdits(1) = 1 press
    expect(calcShiftTabPresses(baseCycle, 'default', 'acceptEdits')).toBe(1);
    // default(0) → plan(2) = 2 presses
    expect(calcShiftTabPresses(baseCycle, 'default', 'plan')).toBe(2);
  });

  it('wraps around correctly', () => {
    // plan(2) → default(0) = 1 press (wraps)
    expect(calcShiftTabPresses(baseCycle, 'plan', 'default')).toBe(1);
    // acceptEdits(1) → default(0) = 2 presses (wraps)
    expect(calcShiftTabPresses(baseCycle, 'acceptEdits', 'default')).toBe(2);
  });

  it('works with full cycle', () => {
    // default(0) → auto(4) = 4 presses
    expect(calcShiftTabPresses(fullCycle, 'default', 'auto')).toBe(4);
    // auto(4) → default(0) = 1 press (wraps)
    expect(calcShiftTabPresses(fullCycle, 'auto', 'default')).toBe(1);
    // plan(2) → bypassPermissions(3) = 1 press
    expect(calcShiftTabPresses(fullCycle, 'plan', 'bypassPermissions')).toBe(1);
  });

  it('returns -1 for modes not in the cycle', () => {
    expect(calcShiftTabPresses(baseCycle, 'default', 'auto')).toBe(-1);
    expect(calcShiftTabPresses(baseCycle, 'dontAsk', 'default')).toBe(-1);
    expect(calcShiftTabPresses(baseCycle, 'default', 'bypassPermissions')).toBe(-1);
  });
});

describe('task_queue permission_mode column', () => {
  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => resetDbForTest());

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM task_queue').run();
    db.prepare('DELETE FROM sessions').run();
    // Insert a test session
    db.prepare(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, hook_mode)
       VALUES ('s1', 'test', '/tmp', 'idle', datetime('now'), 'claude', 'live')`,
    ).run();
  });

  it('stores and retrieves permission_mode on tasks', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO task_queue (prompt, cwd, target_session_id, status, priority, retry_count, max_retries, created_at, permission_mode)
       VALUES ('test', '/tmp', 's1', 'pending', 0, 0, 3, datetime('now'), 'plan')`,
    ).run();
    const row = db.prepare('SELECT permission_mode FROM task_queue ORDER BY id DESC LIMIT 1').get() as { permission_mode: string };
    expect(row.permission_mode).toBe('plan');
  });

  it('allows NULL permission_mode (default behavior)', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO task_queue (prompt, cwd, target_session_id, status, priority, retry_count, max_retries, created_at)
       VALUES ('test', '/tmp', 's1', 'pending', 0, 0, 3, datetime('now'))`,
    ).run();
    const row = db.prepare('SELECT permission_mode FROM task_queue ORDER BY id DESC LIMIT 1').get() as { permission_mode: string | null };
    expect(row.permission_mode).toBeNull();
  });
});

describe('sessions allow_bypass_permissions column', () => {
  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => resetDbForTest());

  beforeEach(() => {
    getDb().prepare('DELETE FROM sessions').run();
  });

  it('stores allow_bypass_permissions flag', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, allow_bypass_permissions)
       VALUES ('s-bp', 'test', '/tmp', 'idle', datetime('now'), 'claude', 1)`,
    ).run();
    const row = db.prepare('SELECT allow_bypass_permissions FROM sessions WHERE session_id = ?').get('s-bp') as { allow_bypass_permissions: number };
    expect(row.allow_bypass_permissions).toBe(1);
  });

  it('defaults to NULL when not set', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type)
       VALUES ('s-no-bp', 'test', '/tmp', 'idle', datetime('now'), 'claude')`,
    ).run();
    const row = db.prepare('SELECT allow_bypass_permissions FROM sessions WHERE session_id = ?').get('s-no-bp') as { allow_bypass_permissions: number | null };
    expect(row.allow_bypass_permissions).toBeNull();
  });
});
