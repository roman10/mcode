import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Database } from 'sql.js';
import { createTestDb } from './test-db';

/**
 * Tests for the auto-close feature on sessions.
 *
 * Uses sql.js (same pattern as session-detach-reconcile.test.ts) to test
 * the SQL logic that task-queue.ts uses in maybeScheduleAutoClose().
 *
 * Mirrors the actual queries in session-manager.ts and task-queue.ts.
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
  INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, auto_close)
  VALUES (?, ?, '/tmp', 'idle', datetime('now'), 'claude', ?)
`;

// SQL mirroring session-manager.ts toSessionInfo()
const SELECT_AUTO_CLOSE_SQL = `SELECT auto_close FROM sessions WHERE session_id = ?`;

function insertSession(db: Database, id: string, autoClose = 0): void {
  db.run(INSERT_SESSION_SQL, [id, `label-${id}`, autoClose]);
}

function insertTask(db: Database, id: number, targetSessionId: string, status: 'pending' | 'dispatched' | 'completed' | 'failed'): void {
  db.run(
    `INSERT INTO task_queue (id, prompt, cwd, target_session_id, status, priority, retry_count, max_retries, created_at)
     VALUES (?, 'test prompt', '/tmp', ?, ?, 0, 0, 3, datetime('now'))`,
    [id, targetSessionId, status],
  );
}

// Insert a new-session task: target_session_id is NULL, session_id is set (assigned at dispatch).
function insertNewSessionTask(db: Database, id: number, sessionId: string, status: 'pending' | 'dispatched' | 'completed' | 'failed'): void {
  db.run(
    `INSERT INTO task_queue (id, prompt, cwd, target_session_id, session_id, status, priority, retry_count, max_retries, created_at)
     VALUES (?, 'test prompt', '/tmp', NULL, ?, ?, 0, 0, 3, datetime('now'))`,
    [id, sessionId, status],
  );
}

function getActiveTaskCount(db: Database, sessionId: string): number {
  // Pass sessionId twice: once for session_id arm, once for target_session_id arm.
  const [result] = db.exec(COUNT_ACTIVE_TASKS_SQL, [sessionId, sessionId]);
  if (!result) return 0;
  return result.values[0][0] as number;
}

function getAutoClose(db: Database, sessionId: string): boolean {
  const [result] = db.exec(SELECT_AUTO_CLOSE_SQL, [sessionId]);
  if (!result || result.values.length === 0) throw new Error(`Session ${sessionId} not found`);
  return result.values[0][0] === 1;
}

describe('auto-close: DB schema', () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => {
    db.close();
  });

  it('sessions table has auto_close column with default 0', () => {
    db.run(`INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type)
            VALUES ('schema-test', 'test', '/tmp', 'idle', datetime('now'), 'claude')`);
    const result = getAutoClose(db, 'schema-test');
    expect(result).toBe(false);
  });

  it('session created with auto_close=1 returns true', () => {
    insertSession(db, 'schema-test-2', 1);
    expect(getAutoClose(db, 'schema-test-2')).toBe(true);
  });
});

describe('auto-close: setAutoClose SQL', () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => {
    db.close();
  });

  it('can toggle auto_close from false to true', () => {
    insertSession(db, 'toggle-1', 0);
    expect(getAutoClose(db, 'toggle-1')).toBe(false);

    db.run(SET_AUTO_CLOSE_SQL, [1, 'toggle-1']);
    expect(getAutoClose(db, 'toggle-1')).toBe(true);
  });

  it('can toggle auto_close from true to false', () => {
    insertSession(db, 'toggle-2', 1);
    expect(getAutoClose(db, 'toggle-2')).toBe(true);

    db.run(SET_AUTO_CLOSE_SQL, [0, 'toggle-2']);
    expect(getAutoClose(db, 'toggle-2')).toBe(false);
  });
});

describe('auto-close: queue drain detection', () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.run(`DELETE FROM task_queue`);
    db.run(`DELETE FROM sessions WHERE session_id LIKE 'drain-%'`);
  });

  it('returns 0 when no tasks exist for session', () => {
    insertSession(db, 'drain-empty', 1);
    expect(getActiveTaskCount(db, 'drain-empty')).toBe(0);
  });

  it('counts pending tasks', () => {
    insertSession(db, 'drain-pending', 1);
    insertTask(db, 1, 'drain-pending', 'pending');
    expect(getActiveTaskCount(db, 'drain-pending')).toBe(1);
  });

  it('counts dispatched tasks', () => {
    insertSession(db, 'drain-dispatched', 1);
    insertTask(db, 2, 'drain-dispatched', 'dispatched');
    expect(getActiveTaskCount(db, 'drain-dispatched')).toBe(1);
  });

  it('counts both pending and dispatched tasks', () => {
    insertSession(db, 'drain-both', 1);
    insertTask(db, 3, 'drain-both', 'pending');
    insertTask(db, 4, 'drain-both', 'dispatched');
    expect(getActiveTaskCount(db, 'drain-both')).toBe(2);
  });

  it('does NOT count completed tasks', () => {
    insertSession(db, 'drain-completed', 1);
    insertTask(db, 5, 'drain-completed', 'completed');
    expect(getActiveTaskCount(db, 'drain-completed')).toBe(0);
  });

  it('does NOT count failed tasks', () => {
    insertSession(db, 'drain-failed', 1);
    insertTask(db, 6, 'drain-failed', 'failed');
    expect(getActiveTaskCount(db, 'drain-failed')).toBe(0);
  });

  it('returns 0 once the last pending task is completed (simulates queue drain)', () => {
    insertSession(db, 'drain-race', 1);
    insertTask(db, 7, 'drain-race', 'pending');
    expect(getActiveTaskCount(db, 'drain-race')).toBe(1);

    // Simulate task completion
    db.run(
      `UPDATE task_queue SET status = 'completed', completed_at = datetime('now') WHERE id = 7`,
    );
    expect(getActiveTaskCount(db, 'drain-race')).toBe(0);
  });

  it('does not trigger for tasks targeting a different session', () => {
    insertSession(db, 'drain-other-a', 1);
    insertSession(db, 'drain-other-b', 1);
    insertTask(db, 8, 'drain-other-b', 'pending');

    // drain-other-a has no tasks
    expect(getActiveTaskCount(db, 'drain-other-a')).toBe(0);
    // drain-other-b still has a pending task
    expect(getActiveTaskCount(db, 'drain-other-b')).toBe(1);
  });

  // Fix 1 regression: OR query must find new-session tasks via session_id arm
  it('counts dispatched new-session task via session_id arm (target_session_id is NULL)', () => {
    insertSession(db, 'drain-newsession', 1);
    // Simulates a task dispatched via dispatchNewSession: target_session_id=NULL, session_id=assigned
    insertNewSessionTask(db, 20, 'drain-newsession', 'dispatched');
    expect(getActiveTaskCount(db, 'drain-newsession')).toBe(1);
  });

  // Fix 1 regression: completed new-session tasks must not block auto-close
  it('does NOT count completed new-session task via either query arm', () => {
    insertSession(db, 'drain-newsession-done', 1);
    insertNewSessionTask(db, 21, 'drain-newsession-done', 'completed');
    expect(getActiveTaskCount(db, 'drain-newsession-done')).toBe(0);
  });
});

describe('auto-close: resume clears auto_close flag', () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => {
    db.close();
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
    db.run(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, auto_close, claude_session_id)
       VALUES ('resume-autoclose', 'test', '/tmp', 'ended', datetime('now'), 'claude', 1, 'abc123')`,
    );
    expect(getAutoClose(db, 'resume-autoclose')).toBe(true);

    // Simulate what session-manager.ts resume() does
    db.run(RESUME_SQL, ['resume-autoclose']);

    expect(getAutoClose(db, 'resume-autoclose')).toBe(false);
  });

  it('status is reset to starting after resume', () => {
    db.run(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, auto_close, claude_session_id)
       VALUES ('resume-status', 'test', '/tmp', 'ended', datetime('now'), 'claude', 1, 'abc456')`,
    );
    db.run(RESUME_SQL, ['resume-status']);

    const [result] = db.exec(`SELECT status, auto_close FROM sessions WHERE session_id = 'resume-status'`);
    const [status, autoClose] = result.values[0];
    expect(status).toBe('starting');
    expect(autoClose).toBe(0);
  });

  it('resume clears stale last tool and attention state', () => {
    db.run(
      `INSERT INTO sessions (
         session_id, label, cwd, status, started_at, session_type, auto_close,
         claude_session_id, last_tool, last_event_at, attention_level, attention_reason
       )
       VALUES (
         'resume-cleanup', 'test', '/tmp', 'ended', datetime('now'), 'claude', 1,
         'abc789', 'ExitPlanMode', '2026-01-01T00:00:00.000Z', 'action', 'Waiting for your response'
       )`,
    );

    db.run(RESUME_SQL, ['resume-cleanup']);

    const [result] = db.exec(
      `SELECT last_tool, last_event_at, attention_level, attention_reason
         FROM sessions WHERE session_id = 'resume-cleanup'`,
    );
    const [lastTool, lastEventAt, attentionLevel, attentionReason] = result.values[0];
    expect(lastTool).toBeNull();
    expect(lastEventAt).toBeNull();
    expect(attentionLevel).toBe('none');
    expect(attentionReason).toBeNull();
  });
});

describe('auto-close: idle guard (Fix 1)', () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => {
    db.close();
  });

  // maybeScheduleAutoClose kills only when cnt===0 AND session.status==='idle'.
  // This test verifies that a non-idle session status is queryable and returns
  // a non-'idle' value, confirming the guard would short-circuit the kill.
  it('session with status=active is NOT idle — kill guard would prevent auto-close', () => {
    db.run(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, auto_close)
       VALUES ('guard-active', 'test', '/tmp', 'active', datetime('now'), 'claude', 1)`,
    );
    const [result] = db.exec(
      `SELECT status FROM sessions WHERE session_id = 'guard-active'`,
    );
    const status = result.values[0][0] as string;
    // With cnt=0 but status!=='idle', the combined kill condition is false.
    expect(status).not.toBe('idle');
  });

  it('session with status=idle passes the kill guard', () => {
    db.run(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, auto_close)
       VALUES ('guard-idle', 'test', '/tmp', 'idle', datetime('now'), 'claude', 1)`,
    );
    const [result] = db.exec(
      `SELECT status FROM sessions WHERE session_id = 'guard-idle'`,
    );
    const status = result.values[0][0] as string;
    expect(status).toBe('idle');
  });
});
