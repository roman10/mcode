import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getDb, resetDbForTest } from '../../../src/main/db';

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

function insertSession(id: string, status: string, attentionLevel = 'none', attentionReason: string | null = null, sessionType = 'claude'): void {
  getDb().prepare(
    `INSERT INTO sessions (session_id, label, cwd, status, started_at, attention_level, attention_reason, session_type, hook_mode)
     VALUES (?, ?, '/tmp', ?, datetime('now'), ?, ?, ?, 'live')`,
  ).run(id, `label-${id}`, status, attentionLevel, attentionReason, sessionType);
}

function getSession(id: string): { status: string; pre_detach_status: string | null; attention_level: string; attention_reason: string | null } {
  const row = getDb().prepare(
    `SELECT status, pre_detach_status, attention_level, attention_reason FROM sessions WHERE session_id = ?`,
  ).get(id) as { status: string; pre_detach_status: string | null; attention_level: string; attention_reason: string | null } | undefined;
  if (!row) throw new Error(`Session ${id} not found`);
  return row;
}

describe('detach/reconcile cycle', () => {
  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM events').run();
    db.prepare('DELETE FROM sessions').run();
  });

  describe('detachAllActive', () => {
    it('saves pre_detach_status and sets status to detached', () => {
      insertSession('active-1', 'active');
      insertSession('idle-1', 'idle');
      insertSession('waiting-1', 'waiting');
      insertSession('starting-1', 'starting');

      getDb().prepare(DETACH_ALL_SQL).run();

      for (const id of ['active-1', 'idle-1', 'waiting-1', 'starting-1']) {
        const s = getSession(id);
        expect(s.status).toBe('detached');
      }

      expect(getSession('active-1').pre_detach_status).toBe('active');
      expect(getSession('idle-1').pre_detach_status).toBe('idle');
      expect(getSession('waiting-1').pre_detach_status).toBe('waiting');
      expect(getSession('starting-1').pre_detach_status).toBe('starting');
    });

    it('does not touch ended sessions', () => {
      insertSession('ended-1', 'ended');

      getDb().prepare(DETACH_ALL_SQL).run();

      const s = getSession('ended-1');
      expect(s.status).toBe('ended');
      expect(s.pre_detach_status).toBeNull();
    });

    it('does not touch already-detached sessions', () => {
      insertSession('already-detached', 'active');
      // First detach
      getDb().prepare(DETACH_ALL_SQL).run();
      expect(getSession('already-detached').pre_detach_status).toBe('active');

      // Second detach should be a no-op (already detached)
      getDb().prepare(DETACH_ALL_SQL).run();
      expect(getSession('already-detached').pre_detach_status).toBe('active');
    });

    it('preserves attention levels through detach', () => {
      insertSession('with-attention', 'idle', 'action', 'Finished — awaiting input');

      getDb().prepare(DETACH_ALL_SQL).run();

      const s = getSession('with-attention');
      expect(s.status).toBe('detached');
      expect(s.attention_level).toBe('action');
      expect(s.attention_reason).toBe('Finished — awaiting input');
    });
  });

  describe('reconcileDetachedSessions', () => {
    beforeEach(() => {
      // Set up sessions in various pre-detach states
      insertSession('was-active', 'active');
      insertSession('was-idle', 'idle', 'action', 'Finished — awaiting input');
      insertSession('was-waiting', 'waiting', 'action', 'Permission needed: Bash');
      insertSession('was-starting', 'starting');

      // Detach all
      getDb().prepare(DETACH_ALL_SQL).run();
    });

    it('restores pre-detach status for alive sessions', () => {
      const aliveSet = new Set(['was-active', 'was-idle', 'was-waiting', 'was-starting']);

      const rows = getDb().prepare(SELECT_DETACHED_SQL).all() as Array<{ session_id: string; pre_detach_status: string | null }>;
      for (const row of rows) {
        if (aliveSet.has(row.session_id)) {
          const restoreStatus = row.pre_detach_status || 'active';
          getDb().prepare(RESTORE_STATUS_SQL).run(restoreStatus, row.session_id);
        }
      }

      expect(getSession('was-active').status).toBe('active');
      expect(getSession('was-idle').status).toBe('idle');
      expect(getSession('was-waiting').status).toBe('waiting');
      expect(getSession('was-starting').status).toBe('starting');
    });

    it('clears pre_detach_status after restore', () => {
      const rows = getDb().prepare(SELECT_DETACHED_SQL).all() as Array<{ session_id: string; pre_detach_status: string | null }>;
      for (const row of rows) {
        const restoreStatus = row.pre_detach_status || 'active';
        getDb().prepare(RESTORE_STATUS_SQL).run(restoreStatus, row.session_id);
      }

      for (const id of ['was-active', 'was-idle', 'was-waiting', 'was-starting']) {
        expect(getSession(id).pre_detach_status).toBeNull();
      }
    });

    it('marks dead sessions as ended', () => {
      const aliveSet = new Set(['was-active']); // Only one alive

      const rows = getDb().prepare(SELECT_DETACHED_SQL).all() as Array<{ session_id: string; pre_detach_status: string | null }>;
      for (const row of rows) {
        if (aliveSet.has(row.session_id)) {
          const restoreStatus = row.pre_detach_status || 'active';
          getDb().prepare(RESTORE_STATUS_SQL).run(restoreStatus, row.session_id);
        } else {
          getDb().prepare(MARK_ENDED_SQL).run(row.session_id);
        }
      }

      expect(getSession('was-active').status).toBe('active');
      expect(getSession('was-idle').status).toBe('ended');
      expect(getSession('was-waiting').status).toBe('ended');
      expect(getSession('was-starting').status).toBe('ended');
    });

    it('preserves attention through detach+restore cycle', () => {
      // was-idle had attention_level='action', reason='Claude finished...'
      const rows = getDb().prepare(SELECT_DETACHED_SQL).all() as Array<{ session_id: string; pre_detach_status: string | null }>;
      for (const row of rows) {
        const restoreStatus = row.pre_detach_status || 'active';
        getDb().prepare(RESTORE_STATUS_SQL).run(restoreStatus, row.session_id);
      }

      const s = getSession('was-idle');
      expect(s.status).toBe('idle');
      expect(s.attention_level).toBe('action');
      expect(s.attention_reason).toBe('Finished — awaiting input');
    });

    it('defaults to active when pre_detach_status is NULL (legacy data)', () => {
      // Simulate legacy data: detached session with no pre_detach_status
      getDb().prepare('DELETE FROM sessions').run();
      insertSession('legacy', 'active');
      // Manually set to detached without setting pre_detach_status (old behavior)
      getDb().prepare(`UPDATE sessions SET status = 'detached' WHERE session_id = 'legacy'`).run();

      const rows = getDb().prepare(SELECT_DETACHED_SQL).all() as Array<{ session_id: string; pre_detach_status: string | null }>;
      const row = rows[0];
      expect(row.pre_detach_status).toBeNull();

      const restoreStatus = row.pre_detach_status || 'active';
      getDb().prepare(RESTORE_STATUS_SQL).run(restoreStatus, row.session_id);

      expect(getSession('legacy').status).toBe('active');
    });
  });

  describe('killAllTerminalSessions', () => {
    it('marks terminal sessions as ended, leaves agent sessions untouched', () => {
      insertSession('terminal-1', 'active', 'none', null, 'terminal');
      insertSession('terminal-2', 'idle', 'none', null, 'terminal');
      insertSession('claude-1', 'active');

      getDb().prepare(KILL_TERMINALS_SQL).run();

      expect(getSession('terminal-1').status).toBe('ended');
      expect(getSession('terminal-2').status).toBe('ended');
      expect(getSession('claude-1').status).toBe('active');
    });

    it('does not touch already-ended or detached terminal sessions', () => {
      insertSession('already-ended', 'ended', 'none', null, 'terminal');
      insertSession('already-detached', 'detached', 'none', null, 'terminal');

      getDb().prepare(KILL_TERMINALS_SQL).run();

      expect(getSession('already-ended').status).toBe('ended');
      expect(getSession('already-detached').status).toBe('detached');
    });

    it('detachAllActive after kill leaves terminal sessions as ended, agent sessions as detached', () => {
      insertSession('terminal-1', 'active', 'none', null, 'terminal');
      insertSession('claude-1', 'active');

      getDb().prepare(KILL_TERMINALS_SQL).run();
      getDb().prepare(DETACH_ALL_SQL).run();

      expect(getSession('terminal-1').status).toBe('ended');
      expect(getSession('claude-1').status).toBe('detached');
    });
  });

  describe('activeSessionCounts', () => {
    it('returns correct counts by type', () => {
      insertSession('claude-active', 'active');
      insertSession('claude-idle', 'idle');
      insertSession('terminal-1', 'active', 'none', null, 'terminal');
      insertSession('ended-claude', 'ended');
      insertSession('ended-terminal', 'ended', 'none', null, 'terminal');

      const row = getDb().prepare(ACTIVE_SESSION_COUNTS_SQL).get() as { agent: number | null; terminal: number | null };
      expect(row.agent).toBe(2);
      expect(row.terminal).toBe(1);
    });

    it('returns zeros when no active sessions', () => {
      const row = getDb().prepare(ACTIVE_SESSION_COUNTS_SQL).get() as { agent: number | null; terminal: number | null };
      expect(row.agent ?? 0).toBe(0);
      expect(row.terminal ?? 0).toBe(0);
    });
  });
});
