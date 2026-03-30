import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Database } from 'sql.js';
import { createTestDb } from './test-db';

/**
 * Tests for the detach/reconcile cycle that runs on app close/reopen.
 * Verifies that pre-detach status is preserved and restored correctly.
 *
 * Uses the same SQL statements as session-repository.ts to ensure parity.
 */

// SQL mirroring session-repository.ts markAllDetached()
const DETACH_ALL_SQL = `UPDATE sessions SET pre_detach_status = status, status = 'detached' WHERE status NOT IN ('ended', 'detached')`;

// SQL mirroring session-repository.ts markTerminalSessionsEnded()
const KILL_TERMINALS_SQL = `UPDATE sessions SET status = 'ended' WHERE session_type = 'terminal' AND status NOT IN ('ended', 'detached')`;

// SQL mirroring session-repository.ts countActiveSessions()
const ACTIVE_SESSION_COUNTS_SQL = `
  SELECT
    SUM(CASE WHEN session_type != 'terminal' THEN 1 ELSE 0 END) as agent,
    SUM(CASE WHEN session_type  = 'terminal' THEN 1 ELSE 0 END) as terminal
  FROM sessions
  WHERE status IN ('starting', 'active', 'idle', 'waiting')
`;

// SQL mirroring session-repository.ts getDetachedSessions()
const SELECT_DETACHED_SQL = `SELECT session_id, pre_detach_status FROM sessions WHERE status = 'detached'`;

// SQL mirroring reconcileDetachedSessions() — restore status via updateSession()
const RESTORE_STATUS_SQL = `UPDATE sessions SET status = ?, pre_detach_status = NULL WHERE session_id = ?`;

// SQL mirroring updateStatus() — mark ended via updateSession()
const MARK_ENDED_SQL = `UPDATE sessions SET status = 'ended', ended_at = datetime('now'), attention_level = 'none', attention_reason = NULL WHERE session_id = ?`;

function insertSession(db: Database, id: string, status: string, attentionLevel = 'none', attentionReason: string | null = null, sessionType = 'claude'): void {
  db.run(
    `INSERT INTO sessions (session_id, label, cwd, status, started_at, attention_level, attention_reason, session_type)
     VALUES (?, ?, '/tmp', ?, datetime('now'), ?, ?, ?)`,
    [id, `label-${id}`, status, attentionLevel, attentionReason, sessionType],
  );
}

function getSession(db: Database, id: string): { status: string; pre_detach_status: string | null; attention_level: string; attention_reason: string | null } {
  const [result] = db.exec(
    `SELECT status, pre_detach_status, attention_level, attention_reason FROM sessions WHERE session_id = ?`,
    [id],
  );
  if (!result || result.values.length === 0) throw new Error(`Session ${id} not found`);
  const [status, pre_detach_status, attention_level, attention_reason] = result.values[0];
  return {
    status: status as string,
    pre_detach_status: pre_detach_status as string | null,
    attention_level: attention_level as string,
    attention_reason: attention_reason as string | null,
  };
}

describe('detach/reconcile cycle', () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.run('DELETE FROM events');
    db.run('DELETE FROM sessions');
  });

  describe('detachAllActive', () => {
    it('saves pre_detach_status and sets status to detached', () => {
      insertSession(db, 'active-1', 'active');
      insertSession(db, 'idle-1', 'idle');
      insertSession(db, 'waiting-1', 'waiting');
      insertSession(db, 'starting-1', 'starting');

      db.run(DETACH_ALL_SQL);

      for (const id of ['active-1', 'idle-1', 'waiting-1', 'starting-1']) {
        const s = getSession(db, id);
        expect(s.status).toBe('detached');
      }

      expect(getSession(db, 'active-1').pre_detach_status).toBe('active');
      expect(getSession(db, 'idle-1').pre_detach_status).toBe('idle');
      expect(getSession(db, 'waiting-1').pre_detach_status).toBe('waiting');
      expect(getSession(db, 'starting-1').pre_detach_status).toBe('starting');
    });

    it('does not touch ended sessions', () => {
      insertSession(db, 'ended-1', 'ended');

      db.run(DETACH_ALL_SQL);

      const s = getSession(db, 'ended-1');
      expect(s.status).toBe('ended');
      expect(s.pre_detach_status).toBeNull();
    });

    it('does not touch already-detached sessions', () => {
      insertSession(db, 'already-detached', 'active');
      // First detach
      db.run(DETACH_ALL_SQL);
      expect(getSession(db, 'already-detached').pre_detach_status).toBe('active');

      // Second detach should be a no-op (already detached)
      db.run(DETACH_ALL_SQL);
      expect(getSession(db, 'already-detached').pre_detach_status).toBe('active');
    });

    it('preserves attention levels through detach', () => {
      insertSession(db, 'with-attention', 'idle', 'action', 'Finished — awaiting input');

      db.run(DETACH_ALL_SQL);

      const s = getSession(db, 'with-attention');
      expect(s.status).toBe('detached');
      expect(s.attention_level).toBe('action');
      expect(s.attention_reason).toBe('Finished — awaiting input');
    });
  });

  describe('reconcileDetachedSessions', () => {
    beforeEach(() => {
      // Set up sessions in various pre-detach states
      insertSession(db, 'was-active', 'active');
      insertSession(db, 'was-idle', 'idle', 'action', 'Finished — awaiting input');
      insertSession(db, 'was-waiting', 'waiting', 'action', 'Permission needed: Bash');
      insertSession(db, 'was-starting', 'starting');

      // Detach all
      db.run(DETACH_ALL_SQL);
    });

    it('restores pre-detach status for alive sessions', () => {
      const aliveSet = new Set(['was-active', 'was-idle', 'was-waiting', 'was-starting']);

      const [result] = db.exec(SELECT_DETACHED_SQL);
      for (const row of result.values) {
        const [session_id, pre_detach_status] = row as [string, string | null];
        if (aliveSet.has(session_id)) {
          const restoreStatus = pre_detach_status || 'active';
          db.run(RESTORE_STATUS_SQL, [restoreStatus, session_id]);
        }
      }

      expect(getSession(db, 'was-active').status).toBe('active');
      expect(getSession(db, 'was-idle').status).toBe('idle');
      expect(getSession(db, 'was-waiting').status).toBe('waiting');
      expect(getSession(db, 'was-starting').status).toBe('starting');
    });

    it('clears pre_detach_status after restore', () => {
      const [result] = db.exec(SELECT_DETACHED_SQL);
      for (const row of result.values) {
        const [session_id, pre_detach_status] = row as [string, string | null];
        const restoreStatus = pre_detach_status || 'active';
        db.run(RESTORE_STATUS_SQL, [restoreStatus, session_id]);
      }

      for (const id of ['was-active', 'was-idle', 'was-waiting', 'was-starting']) {
        expect(getSession(db, id).pre_detach_status).toBeNull();
      }
    });

    it('marks dead sessions as ended', () => {
      const aliveSet = new Set(['was-active']); // Only one alive

      const [result] = db.exec(SELECT_DETACHED_SQL);
      for (const row of result.values) {
        const [session_id, pre_detach_status] = row as [string, string | null];
        if (aliveSet.has(session_id)) {
          const restoreStatus = pre_detach_status || 'active';
          db.run(RESTORE_STATUS_SQL, [restoreStatus, session_id]);
        } else {
          db.run(MARK_ENDED_SQL, [session_id]);
        }
      }

      expect(getSession(db, 'was-active').status).toBe('active');
      expect(getSession(db, 'was-idle').status).toBe('ended');
      expect(getSession(db, 'was-waiting').status).toBe('ended');
      expect(getSession(db, 'was-starting').status).toBe('ended');
    });

    it('preserves attention through detach+restore cycle', () => {
      // was-idle had attention_level='action', reason='Claude finished...'
      const [result] = db.exec(SELECT_DETACHED_SQL);
      for (const row of result.values) {
        const [session_id, pre_detach_status] = row as [string, string | null];
        const restoreStatus = pre_detach_status || 'active';
        db.run(RESTORE_STATUS_SQL, [restoreStatus, session_id]);
      }

      const s = getSession(db, 'was-idle');
      expect(s.status).toBe('idle');
      expect(s.attention_level).toBe('action');
      expect(s.attention_reason).toBe('Finished — awaiting input');
    });

    it('defaults to active when pre_detach_status is NULL (legacy data)', () => {
      // Simulate legacy data: detached session with no pre_detach_status
      db.run('DELETE FROM sessions');
      insertSession(db, 'legacy', 'active');
      // Manually set to detached without setting pre_detach_status (old behavior)
      db.run(`UPDATE sessions SET status = 'detached' WHERE session_id = 'legacy'`);

      const [result] = db.exec(SELECT_DETACHED_SQL);
      const [session_id, pre_detach_status] = result.values[0] as [string, string | null];
      expect(pre_detach_status).toBeNull();

      const restoreStatus = pre_detach_status || 'active';
      db.run(RESTORE_STATUS_SQL, [restoreStatus, session_id]);

      expect(getSession(db, 'legacy').status).toBe('active');
    });
  });

  describe('killAllTerminalSessions', () => {
    it('marks terminal sessions as ended, leaves agent sessions untouched', () => {
      insertSession(db, 'terminal-1', 'active', 'none', null, 'terminal');
      insertSession(db, 'terminal-2', 'idle', 'none', null, 'terminal');
      insertSession(db, 'claude-1', 'active');

      db.run(KILL_TERMINALS_SQL);

      expect(getSession(db, 'terminal-1').status).toBe('ended');
      expect(getSession(db, 'terminal-2').status).toBe('ended');
      expect(getSession(db, 'claude-1').status).toBe('active');
    });

    it('does not touch already-ended or detached terminal sessions', () => {
      insertSession(db, 'already-ended', 'ended', 'none', null, 'terminal');
      insertSession(db, 'already-detached', 'detached', 'none', null, 'terminal');

      db.run(KILL_TERMINALS_SQL);

      expect(getSession(db, 'already-ended').status).toBe('ended');
      expect(getSession(db, 'already-detached').status).toBe('detached');
    });

    it('detachAllActive after kill leaves terminal sessions as ended, agent sessions as detached', () => {
      insertSession(db, 'terminal-1', 'active', 'none', null, 'terminal');
      insertSession(db, 'claude-1', 'active');

      db.run(KILL_TERMINALS_SQL);
      db.run(DETACH_ALL_SQL);

      expect(getSession(db, 'terminal-1').status).toBe('ended');
      expect(getSession(db, 'claude-1').status).toBe('detached');
    });
  });

  describe('activeSessionCounts', () => {
    it('returns correct counts by type', () => {
      insertSession(db, 'claude-active', 'active');
      insertSession(db, 'claude-idle', 'idle');
      insertSession(db, 'terminal-1', 'active', 'none', null, 'terminal');
      insertSession(db, 'ended-claude', 'ended');
      insertSession(db, 'ended-terminal', 'ended', 'none', null, 'terminal');

      const [result] = db.exec(ACTIVE_SESSION_COUNTS_SQL);
      const [agent, terminal] = result.values[0] as [number, number];
      expect(agent).toBe(2);
      expect(terminal).toBe(1);
    });

    it('returns zeros when no active sessions', () => {
      const [result] = db.exec(ACTIVE_SESSION_COUNTS_SQL);
      const [agent, terminal] = result.values[0] as [number | null, number | null];
      expect(agent ?? 0).toBe(0);
      expect(terminal ?? 0).toBe(0);
    });
  });
});
