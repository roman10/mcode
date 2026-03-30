import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getDb, resetDbForTest } from '../../../src/main/db';
import {
  markAllDetached,
  markTerminalSessionsEnded,
  countActiveSessions,
  getDetachedSessions,
  getSessionRecord,
  updateSession,
  insertSession as repoInsertSession,
} from '../../../src/main/session/session-repository';

/**
 * Tests for the detach/reconcile cycle that runs on app close/reopen.
 * Verifies that pre-detach status is preserved and restored correctly.
 */

function insertSession(id: string, status: string, attentionLevel = 'none', attentionReason: string | null = null, sessionType = 'claude'): void {
  repoInsertSession({
    sessionId: id,
    label: `label-${id}`,
    cwd: '/tmp',
    startedAt: new Date().toISOString(),
    hookMode: 'live',
    sessionType,
  });
  // Update to desired status and attention (insertSession always starts as 'starting')
  updateSession(id, { status, attentionLevel, attentionReason });
}

function getSessionRow(id: string): { status: string; preDetachStatus: string | null; attentionLevel: string; attentionReason: string | null } {
  const record = getSessionRecord(id);
  if (!record) throw new Error(`Session ${id} not found`);
  return {
    status: record.status,
    preDetachStatus: record.pre_detach_status,
    attentionLevel: record.attention_level,
    attentionReason: record.attention_reason,
  };
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

      markAllDetached();

      for (const id of ['active-1', 'idle-1', 'waiting-1', 'starting-1']) {
        const s = getSessionRow(id);
        expect(s.status).toBe('detached');
      }

      expect(getSessionRow('active-1').preDetachStatus).toBe('active');
      expect(getSessionRow('idle-1').preDetachStatus).toBe('idle');
      expect(getSessionRow('waiting-1').preDetachStatus).toBe('waiting');
      expect(getSessionRow('starting-1').preDetachStatus).toBe('starting');
    });

    it('does not touch ended sessions', () => {
      insertSession('ended-1', 'ended');

      markAllDetached();

      const s = getSessionRow('ended-1');
      expect(s.status).toBe('ended');
      expect(s.preDetachStatus).toBeNull();
    });

    it('does not touch already-detached sessions', () => {
      insertSession('already-detached', 'active');
      // First detach
      markAllDetached();
      expect(getSessionRow('already-detached').preDetachStatus).toBe('active');

      // Second detach should be a no-op (already detached)
      markAllDetached();
      expect(getSessionRow('already-detached').preDetachStatus).toBe('active');
    });

    it('preserves attention levels through detach', () => {
      insertSession('with-attention', 'idle', 'action', 'Finished — awaiting input');

      markAllDetached();

      const s = getSessionRow('with-attention');
      expect(s.status).toBe('detached');
      expect(s.attentionLevel).toBe('action');
      expect(s.attentionReason).toBe('Finished — awaiting input');
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
      markAllDetached();
    });

    it('restores pre-detach status for alive sessions', () => {
      const aliveSet = new Set(['was-active', 'was-idle', 'was-waiting', 'was-starting']);

      const rows = getDetachedSessions();
      for (const row of rows) {
        if (aliveSet.has(row.session_id)) {
          const restoreStatus = row.pre_detach_status || 'active';
          updateSession(row.session_id, { status: restoreStatus, preDetachStatus: null });
        }
      }

      expect(getSessionRow('was-active').status).toBe('active');
      expect(getSessionRow('was-idle').status).toBe('idle');
      expect(getSessionRow('was-waiting').status).toBe('waiting');
      expect(getSessionRow('was-starting').status).toBe('starting');
    });

    it('clears pre_detach_status after restore', () => {
      const rows = getDetachedSessions();
      for (const row of rows) {
        const restoreStatus = row.pre_detach_status || 'active';
        updateSession(row.session_id, { status: restoreStatus, preDetachStatus: null });
      }

      for (const id of ['was-active', 'was-idle', 'was-waiting', 'was-starting']) {
        expect(getSessionRow(id).preDetachStatus).toBeNull();
      }
    });

    it('marks dead sessions as ended', () => {
      const aliveSet = new Set(['was-active']); // Only one alive

      const rows = getDetachedSessions();
      for (const row of rows) {
        if (aliveSet.has(row.session_id)) {
          const restoreStatus = row.pre_detach_status || 'active';
          updateSession(row.session_id, { status: restoreStatus, preDetachStatus: null });
        } else {
          updateSession(row.session_id, {
            status: 'ended',
            endedAt: new Date().toISOString(),
            attentionLevel: 'none',
            attentionReason: null,
          });
        }
      }

      expect(getSessionRow('was-active').status).toBe('active');
      expect(getSessionRow('was-idle').status).toBe('ended');
      expect(getSessionRow('was-waiting').status).toBe('ended');
      expect(getSessionRow('was-starting').status).toBe('ended');
    });

    it('preserves attention through detach+restore cycle', () => {
      // was-idle had attention_level='action', reason='Finished — awaiting input'
      const rows = getDetachedSessions();
      for (const row of rows) {
        const restoreStatus = row.pre_detach_status || 'active';
        updateSession(row.session_id, { status: restoreStatus, preDetachStatus: null });
      }

      const s = getSessionRow('was-idle');
      expect(s.status).toBe('idle');
      expect(s.attentionLevel).toBe('action');
      expect(s.attentionReason).toBe('Finished — awaiting input');
    });

    it('defaults to active when pre_detach_status is NULL (legacy data)', () => {
      // Simulate legacy data: detached session with no pre_detach_status
      getDb().prepare('DELETE FROM sessions').run();
      insertSession('legacy', 'active');
      // Manually set to detached without setting pre_detach_status (old behavior)
      getDb().prepare(`UPDATE sessions SET status = 'detached' WHERE session_id = 'legacy'`).run();

      const rows = getDetachedSessions();
      const row = rows[0];
      expect(row.pre_detach_status).toBeNull();

      const restoreStatus = row.pre_detach_status || 'active';
      updateSession(row.session_id, { status: restoreStatus, preDetachStatus: null });

      expect(getSessionRow('legacy').status).toBe('active');
    });
  });

  describe('killAllTerminalSessions', () => {
    it('marks terminal sessions as ended, leaves agent sessions untouched', () => {
      insertSession('terminal-1', 'active', 'none', null, 'terminal');
      insertSession('terminal-2', 'idle', 'none', null, 'terminal');
      insertSession('claude-1', 'active');

      markTerminalSessionsEnded();

      expect(getSessionRow('terminal-1').status).toBe('ended');
      expect(getSessionRow('terminal-2').status).toBe('ended');
      expect(getSessionRow('claude-1').status).toBe('active');
    });

    it('does not touch already-ended or detached terminal sessions', () => {
      insertSession('already-ended', 'ended', 'none', null, 'terminal');
      insertSession('already-detached', 'detached', 'none', null, 'terminal');

      markTerminalSessionsEnded();

      expect(getSessionRow('already-ended').status).toBe('ended');
      expect(getSessionRow('already-detached').status).toBe('detached');
    });

    it('detachAllActive after kill leaves terminal sessions as ended, agent sessions as detached', () => {
      insertSession('terminal-1', 'active', 'none', null, 'terminal');
      insertSession('claude-1', 'active');

      markTerminalSessionsEnded();
      markAllDetached();

      expect(getSessionRow('terminal-1').status).toBe('ended');
      expect(getSessionRow('claude-1').status).toBe('detached');
    });
  });

  describe('activeSessionCounts', () => {
    it('returns correct counts by type', () => {
      insertSession('claude-active', 'active');
      insertSession('claude-idle', 'idle');
      insertSession('terminal-1', 'active', 'none', null, 'terminal');
      insertSession('ended-claude', 'ended');
      insertSession('ended-terminal', 'ended', 'none', null, 'terminal');

      const counts = countActiveSessions();
      expect(counts.agent).toBe(2);
      expect(counts.terminal).toBe(1);
    });

    it('returns zeros when no active sessions', () => {
      const counts = countActiveSessions();
      expect(counts.agent).toBe(0);
      expect(counts.terminal).toBe(0);
    });
  });
});
