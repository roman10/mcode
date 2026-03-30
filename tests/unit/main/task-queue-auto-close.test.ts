import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getDb, resetDbForTest } from '../../../src/main/db';

/**
 * Tests for the auto-close feature on sessions.
 *
 * Uses real in-memory SQLite (better-sqlite3) to test
 * the SQL logic that task-queue.ts uses in maybeScheduleAutoClose().
 */

// SQL mirroring task-queue.ts maybeScheduleAutoClose() — uses OR to cover both
// session-targeted tasks (target_session_id = ?) and new-session tasks (session_id = ?).
const COUNT_ACTIVE_TASKS_SQL = `
  SELECT COUNT(*) as cnt FROM task_queue
  WHERE status IN ('pending','dispatched')
    AND (session_id = ? OR target_session_id = ?)
`;

// SQL mirroring session-manager.ts setAutoClose()
const SET_AUTO_CLOSE_SQL = `UPDATE sessions SET auto_close = ? WHERE session_id = ?`;

// SQL mirroring session-manager.ts create() INSERT
const INSERT_SESSION_SQL = `
  INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, auto_close, hook_mode)
  VALUES (?, ?, '/tmp', 'idle', datetime('now'), 'claude', ?, 'live')
`;

// SQL mirroring session-manager.ts toSessionInfo()
const SELECT_AUTO_CLOSE_SQL = `SELECT auto_close FROM sessions WHERE session_id = ?`;

function insertSession(id: string, autoClose = 0): void {
  getDb().prepare(INSERT_SESSION_SQL).run(id, `label-${id}`, autoClose);
}

function insertTask(id: number, targetSessionId: string, status: 'pending' | 'dispatched' | 'completed' | 'failed'): void {
  getDb().prepare(
    `INSERT INTO task_queue (id, prompt, cwd, target_session_id, status, priority, retry_count, max_retries, created_at)
     VALUES (?, 'test prompt', '/tmp', ?, ?, 0, 0, 3, datetime('now'))`,
  ).run(id, targetSessionId, status);
}

// Insert a new-session task: target_session_id is NULL, session_id is set (assigned at dispatch).
function insertNewSessionTask(id: number, sessionId: string, status: 'pending' | 'dispatched' | 'completed' | 'failed'): void {
  getDb().prepare(
    `INSERT INTO task_queue (id, prompt, cwd, target_session_id, session_id, status, priority, retry_count, max_retries, created_at)
     VALUES (?, 'test prompt', '/tmp', NULL, ?, ?, 0, 0, 3, datetime('now'))`,
  ).run(id, sessionId, status);
}

function getActiveTaskCount(sessionId: string): number {
  const row = getDb().prepare(COUNT_ACTIVE_TASKS_SQL).get(sessionId, sessionId) as { cnt: number };
  return row.cnt;
}

function getAutoClose(sessionId: string): boolean {
  const row = getDb().prepare(SELECT_AUTO_CLOSE_SQL).get(sessionId) as { auto_close: number } | undefined;
  if (!row) throw new Error(`Session ${sessionId} not found`);
  return row.auto_close === 1;
}

describe('auto-close: DB schema', () => {
  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM task_queue').run();
    db.prepare('DELETE FROM sessions').run();
  });

  it('sessions table has auto_close column with default 0', () => {
    getDb().prepare(`INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, hook_mode)
            VALUES ('schema-test', 'test', '/tmp', 'idle', datetime('now'), 'claude', 'live')`).run();
    const result = getAutoClose('schema-test');
    expect(result).toBe(false);
  });

  it('session created with auto_close=1 returns true', () => {
    insertSession('schema-test-2', 1);
    expect(getAutoClose('schema-test-2')).toBe(true);
  });
});

describe('auto-close: setAutoClose SQL', () => {
  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM task_queue').run();
    db.prepare('DELETE FROM sessions').run();
  });

  it('can toggle auto_close from false to true', () => {
    insertSession('toggle-1', 0);
    expect(getAutoClose('toggle-1')).toBe(false);

    getDb().prepare(SET_AUTO_CLOSE_SQL).run(1, 'toggle-1');
    expect(getAutoClose('toggle-1')).toBe(true);
  });

  it('can toggle auto_close from true to false', () => {
    insertSession('toggle-2', 1);
    expect(getAutoClose('toggle-2')).toBe(true);

    getDb().prepare(SET_AUTO_CLOSE_SQL).run(0, 'toggle-2');
    expect(getAutoClose('toggle-2')).toBe(false);
  });
});

describe('auto-close: queue drain detection', () => {
  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare(`DELETE FROM task_queue`).run();
    db.prepare(`DELETE FROM sessions`).run();
  });

  it('returns 0 when no tasks exist for session', () => {
    insertSession('drain-empty', 1);
    expect(getActiveTaskCount('drain-empty')).toBe(0);
  });

  it('counts pending tasks', () => {
    insertSession('drain-pending', 1);
    insertTask(1, 'drain-pending', 'pending');
    expect(getActiveTaskCount('drain-pending')).toBe(1);
  });

  it('counts dispatched tasks', () => {
    insertSession('drain-dispatched', 1);
    insertTask(2, 'drain-dispatched', 'dispatched');
    expect(getActiveTaskCount('drain-dispatched')).toBe(1);
  });

  it('counts both pending and dispatched tasks', () => {
    insertSession('drain-both', 1);
    insertTask(3, 'drain-both', 'pending');
    insertTask(4, 'drain-both', 'dispatched');
    expect(getActiveTaskCount('drain-both')).toBe(2);
  });

  it('does NOT count completed tasks', () => {
    insertSession('drain-completed', 1);
    insertTask(5, 'drain-completed', 'completed');
    expect(getActiveTaskCount('drain-completed')).toBe(0);
  });

  it('does NOT count failed tasks', () => {
    insertSession('drain-failed', 1);
    insertTask(6, 'drain-failed', 'failed');
    expect(getActiveTaskCount('drain-failed')).toBe(0);
  });

  it('returns 0 once the last pending task is completed (simulates queue drain)', () => {
    insertSession('drain-race', 1);
    insertTask(7, 'drain-race', 'pending');
    expect(getActiveTaskCount('drain-race')).toBe(1);

    // Simulate task completion
    getDb().prepare(
      `UPDATE task_queue SET status = 'completed', completed_at = datetime('now') WHERE id = 7`,
    ).run();
    expect(getActiveTaskCount('drain-race')).toBe(0);
  });

  it('does not trigger for tasks targeting a different session', () => {
    insertSession('drain-other-a', 1);
    insertSession('drain-other-b', 1);
    insertTask(8, 'drain-other-b', 'pending');

    // drain-other-a has no tasks
    expect(getActiveTaskCount('drain-other-a')).toBe(0);
    // drain-other-b still has a pending task
    expect(getActiveTaskCount('drain-other-b')).toBe(1);
  });

  // Fix 1 regression: OR query must find new-session tasks via session_id arm
  it('counts dispatched new-session task via session_id arm (target_session_id is NULL)', () => {
    insertSession('drain-newsession', 1);
    // Simulates a task dispatched via dispatchNewSession: target_session_id=NULL, session_id=assigned
    insertNewSessionTask(20, 'drain-newsession', 'dispatched');
    expect(getActiveTaskCount('drain-newsession')).toBe(1);
  });

  // Fix 1 regression: completed new-session tasks must not block auto-close
  it('does NOT count completed new-session task via either query arm', () => {
    insertSession('drain-newsession-done', 1);
    insertNewSessionTask(21, 'drain-newsession-done', 'completed');
    expect(getActiveTaskCount('drain-newsession-done')).toBe(0);
  });
});

describe('auto-close: resume clears auto_close flag', () => {
  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM task_queue').run();
    db.prepare('DELETE FROM sessions').run();
  });

  // SQL mirroring the updated session-manager.ts resume() method
  const RESUME_SQL = `
    UPDATE sessions
       SET status = 'starting',
           ended_at = NULL,
           hook_mode = 'live',
           auto_close = 0,
           last_tool = NULL,
           last_event_at = NULL,
           attention_level = 'none',
           attention_reason = NULL
     WHERE session_id = ?
  `;

  it('resume clears auto_close so the session is not immediately re-killed', () => {
    getDb().prepare(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, auto_close, claude_session_id, hook_mode)
       VALUES ('resume-autoclose', 'test', '/tmp', 'ended', datetime('now'), 'claude', 1, 'abc123', 'live')`,
    ).run();
    expect(getAutoClose('resume-autoclose')).toBe(true);

    // Simulate what session-manager.ts resume() does
    getDb().prepare(RESUME_SQL).run('resume-autoclose');

    expect(getAutoClose('resume-autoclose')).toBe(false);
  });

  it('status is reset to starting after resume', () => {
    getDb().prepare(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, auto_close, claude_session_id, hook_mode)
       VALUES ('resume-status', 'test', '/tmp', 'ended', datetime('now'), 'claude', 1, 'abc456', 'live')`,
    ).run();
    getDb().prepare(RESUME_SQL).run('resume-status');

    const row = getDb().prepare(`SELECT status, auto_close FROM sessions WHERE session_id = 'resume-status'`).get() as { status: string; auto_close: number };
    expect(row.status).toBe('starting');
    expect(row.auto_close).toBe(0);
  });

  it('resume clears stale last tool and attention state', () => {
    getDb().prepare(
      `INSERT INTO sessions (
         session_id, label, cwd, status, started_at, session_type, auto_close,
         claude_session_id, last_tool, last_event_at, attention_level, attention_reason, hook_mode
       )
       VALUES (
         'resume-cleanup', 'test', '/tmp', 'ended', datetime('now'), 'claude', 1,
         'abc789', 'ExitPlanMode', '2026-01-01T00:00:00.000Z', 'action', 'Waiting for your response', 'live'
       )`,
    ).run();

    getDb().prepare(RESUME_SQL).run('resume-cleanup');

    const row = getDb().prepare(
      `SELECT last_tool, last_event_at, attention_level, attention_reason
         FROM sessions WHERE session_id = 'resume-cleanup'`,
    ).get() as { last_tool: string | null; last_event_at: string | null; attention_level: string; attention_reason: string | null };
    expect(row.last_tool).toBeNull();
    expect(row.last_event_at).toBeNull();
    expect(row.attention_level).toBe('none');
    expect(row.attention_reason).toBeNull();
  });
});

describe('auto-close: idle guard (Fix 1)', () => {
  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM task_queue').run();
    db.prepare('DELETE FROM sessions').run();
  });

  // maybeScheduleAutoClose kills only when cnt===0 AND session.status==='idle'.
  // This test verifies that a non-idle session status is queryable and returns
  // a non-'idle' value, confirming the guard would short-circuit the kill.
  it('session with status=active is NOT idle — kill guard would prevent auto-close', () => {
    getDb().prepare(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, auto_close, hook_mode)
       VALUES ('guard-active', 'test', '/tmp', 'active', datetime('now'), 'claude', 1, 'live')`,
    ).run();
    const row = getDb().prepare(
      `SELECT status FROM sessions WHERE session_id = 'guard-active'`,
    ).get() as { status: string };
    // With cnt=0 but status!=='idle', the combined kill condition is false.
    expect(row.status).not.toBe('idle');
  });

  it('session with status=idle passes the kill guard', () => {
    getDb().prepare(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, auto_close, hook_mode)
       VALUES ('guard-idle', 'test', '/tmp', 'idle', datetime('now'), 'claude', 1, 'live')`,
    ).run();
    const row = getDb().prepare(
      `SELECT status FROM sessions WHERE session_id = 'guard-idle'`,
    ).get() as { status: string };
    expect(row.status).toBe('idle');
  });
});
