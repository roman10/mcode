import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { Database } from 'sql.js';
import { createTestDb } from './test-db';

let testDb: Database;

function normalizeParams(args: any[]): any[] {
  return (args.length === 1 && Array.isArray(args[0]) ? args[0] : args)
    .map((v: any) => v === undefined ? null : v);
}

function wrapDatabase(sqlDb: Database) {
  const self = {
    prepare: (sql: string) => {
      // Return a reusable handle — each run/get/all creates a fresh sql.js
      // statement so the handle can be called multiple times (e.g. inside
      // transactions with prepared-statement reuse).
      return {
        run: (...args: any[]) => {
          const stmt = sqlDb.prepare(sql);
          const params = normalizeParams(args);
          stmt.bind(params);
          stmt.step();
          const changes = sqlDb.getRowsModified();
          stmt.free();
          return { changes };
        },
        get: (...args: any[]) => {
          const stmt = sqlDb.prepare(sql);
          const params = normalizeParams(args);
          stmt.bind(params);
          const result = stmt.step() ? stmt.getAsObject() : undefined;
          stmt.free();
          return result;
        },
        all: (...args: any[]) => {
          const stmt = sqlDb.prepare(sql);
          const params = normalizeParams(args);
          stmt.bind(params);
          const rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();
          return rows;
        },
      };
    },
    transaction: <T>(fn: () => T) => {
      return () => {
        sqlDb.run('BEGIN');
        try {
          const result = fn();
          sqlDb.run('COMMIT');
          return result;
        } catch (e) {
          sqlDb.run('ROLLBACK');
          throw e;
        }
      };
    },
  };
  return self;
}

vi.mock('../../../src/main/db', () => ({
  getDb: vi.fn(() => wrapDatabase(testDb)),
}));

import {
  getSession,
  getSessionRecord,
  listSessions,
  getSessionStatus,
  getSessionHookState,
  getActiveAgentStates,
  getDetachedSessions,
  countActiveSessions,
  hasActiveAgentSessions,
  getLastClaudeDefaults,
  lookupByClaudeSessionId,
  getDistinctCwds,
  findConflictingLabels,
  getTrackedClaudeSessionIds,
  getEndedSessionIds,
  getEmptyEndedSessionIds,
  getActiveTerminalSessionIds,
  hasPendingTasksForSession,
  insertSession,
  updateSession,
  updateAutoLabel,
  setAgentIdIfNull,
  deleteSessionWithEvents,
  deleteSessionsWithEvents,
  markAllEnded,
  markAllDetached,
  markTerminalSessionsEnded,
  clearAllAttention,
} from '../../../src/main/session/session-repository';

function insertTestSession(id: string, overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    label: `test-${id}`,
    label_source: 'auto',
    cwd: '/tmp/test',
    status: 'active',
    started_at: '2026-01-01T00:00:00.000Z',
    session_type: 'claude',
    hook_mode: 'live',
    terminal_config: '{}',
    attention_level: 'none',
    auto_close: 0,
  };
  const merged = { ...defaults, ...overrides };
  const cols = ['session_id', ...Object.keys(merged)];
  const vals = [id, ...Object.values(merged)];
  const placeholders = cols.map(() => '?').join(', ');
  testDb.run(`INSERT INTO sessions (${cols.join(', ')}) VALUES (${placeholders})`, vals);
}

describe('session-repository', () => {
  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(() => {
    testDb.close();
  });

  beforeEach(() => {
    testDb.run('DELETE FROM events');
    testDb.run('DELETE FROM task_queue');
    testDb.run('DELETE FROM sessions');
  });

  // -----------------------------------------------------------------
  // READ functions
  // -----------------------------------------------------------------

  describe('getSession', () => {
    it('returns null for unknown id', () => {
      expect(getSession('nonexistent')).toBeNull();
    });

    it('returns SessionInfo for existing session', () => {
      insertTestSession('s1', { label: 'My Session', cwd: '/home/user', model: 'opus' });
      const info = getSession('s1');
      expect(info).not.toBeNull();
      expect(info!.sessionId).toBe('s1');
      expect(info!.label).toBe('My Session');
      expect(info!.cwd).toBe('/home/user');
      expect(info!.model).toBe('opus');
      expect(info!.status).toBe('active');
    });

    it('maps boolean fields correctly', () => {
      insertTestSession('s2', { auto_close: 1, enable_auto_mode: 1, allow_bypass_permissions: 1 });
      const info = getSession('s2')!;
      expect(info.autoClose).toBe(true);
      expect(info.enableAutoMode).toBe(true);
      expect(info.allowBypassPermissions).toBe(true);
    });
  });

  describe('getSessionRecord', () => {
    it('returns raw DB row', () => {
      insertTestSession('s1', { model: 'sonnet' });
      const row = getSessionRecord('s1');
      expect(row).not.toBeNull();
      expect(row!.session_id).toBe('s1');
      expect(row!.model).toBe('sonnet');
    });
  });

  describe('listSessions', () => {
    it('returns sessions ordered by started_at DESC', () => {
      insertTestSession('s1', { started_at: '2026-01-01T00:00:00.000Z' });
      insertTestSession('s2', { started_at: '2026-01-02T00:00:00.000Z' });
      const list = listSessions();
      expect(list).toHaveLength(2);
      expect(list[0].sessionId).toBe('s2');
      expect(list[1].sessionId).toBe('s1');
    });
  });

  describe('getSessionStatus', () => {
    it('returns status string', () => {
      insertTestSession('s1', { status: 'idle' });
      expect(getSessionStatus('s1')).toBe('idle');
    });

    it('returns null for unknown id', () => {
      expect(getSessionStatus('nonexistent')).toBeNull();
    });
  });

  describe('getSessionHookState', () => {
    it('returns projected row', () => {
      insertTestSession('s1', { model: 'opus', last_tool: 'Bash', worktree: 'wt1' });
      const row = getSessionHookState('s1');
      expect(row).not.toBeNull();
      expect(row!.model).toBe('opus');
      expect(row!.last_tool).toBe('Bash');
      expect(row!.worktree).toBe('wt1');
      expect(row!.session_type).toBe('claude');
    });
  });

  describe('getActiveAgentStates', () => {
    it('returns only active non-terminal sessions', () => {
      insertTestSession('s1', { status: 'active', session_type: 'claude' });
      insertTestSession('s2', { status: 'ended', session_type: 'claude' });
      insertTestSession('s3', { status: 'active', session_type: 'terminal' });
      insertTestSession('s4', { status: 'idle', session_type: 'gemini' });
      const rows = getActiveAgentStates();
      const ids = rows.map((r) => r.session_id);
      expect(ids).toContain('s1');
      expect(ids).toContain('s4');
      expect(ids).not.toContain('s2');
      expect(ids).not.toContain('s3');
    });
  });

  describe('getDetachedSessions', () => {
    it('returns detached sessions with pre_detach_status', () => {
      insertTestSession('s1', { status: 'detached', pre_detach_status: 'active' });
      insertTestSession('s2', { status: 'active' });
      const rows = getDetachedSessions();
      expect(rows).toHaveLength(1);
      expect(rows[0].session_id).toBe('s1');
      expect(rows[0].pre_detach_status).toBe('active');
    });
  });

  describe('countActiveSessions', () => {
    it('counts agent and terminal separately', () => {
      insertTestSession('s1', { status: 'active', session_type: 'claude' });
      insertTestSession('s2', { status: 'idle', session_type: 'gemini' });
      insertTestSession('s3', { status: 'active', session_type: 'terminal' });
      insertTestSession('s4', { status: 'ended', session_type: 'claude' });
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

  describe('hasActiveAgentSessions', () => {
    it('returns true when agent sessions are active', () => {
      insertTestSession('s1', { status: 'idle', session_type: 'claude' });
      expect(hasActiveAgentSessions()).toBe(true);
    });

    it('returns false when only terminals are active', () => {
      insertTestSession('s1', { status: 'active', session_type: 'terminal' });
      expect(hasActiveAgentSessions()).toBe(false);
    });
  });

  describe('getLastClaudeDefaults', () => {
    it('returns defaults from most recent claude session', () => {
      insertTestSession('s1', {
        started_at: '2026-01-01T00:00:00.000Z',
        session_type: 'claude',
        cwd: '/old',
        permission_mode: 'auto',
        effort: 'high',
      });
      insertTestSession('s2', {
        started_at: '2026-01-02T00:00:00.000Z',
        session_type: 'claude',
        cwd: '/new',
        permission_mode: 'default',
      });
      const defaults = getLastClaudeDefaults();
      expect(defaults).not.toBeNull();
      expect(defaults!.cwd).toBe('/new');
      expect(defaults!.permissionMode).toBe('default');
    });

    it('returns null when no claude sessions exist', () => {
      insertTestSession('s1', { session_type: 'terminal' });
      expect(getLastClaudeDefaults()).toBeNull();
    });
  });

  describe('lookupByClaudeSessionId', () => {
    it('finds session by claude_session_id', () => {
      insertTestSession('s1', { claude_session_id: 'claude-abc' });
      expect(lookupByClaudeSessionId('claude-abc')).toBe('s1');
    });

    it('returns null when not found', () => {
      expect(lookupByClaudeSessionId('missing')).toBeNull();
    });
  });

  describe('getDistinctCwds', () => {
    it('returns unique cwds for session type', () => {
      insertTestSession('s1', { cwd: '/a', session_type: 'claude' });
      insertTestSession('s2', { cwd: '/a', session_type: 'claude' });
      insertTestSession('s3', { cwd: '/b', session_type: 'claude' });
      insertTestSession('s4', { cwd: '/c', session_type: 'terminal' });
      const cwds = getDistinctCwds('claude');
      expect(cwds).toHaveLength(2);
      expect(cwds).toContain('/a');
      expect(cwds).toContain('/b');
    });
  });

  describe('findConflictingLabels', () => {
    it('finds exact match and numbered variants', () => {
      insertTestSession('s1', { label: 'myproject' });
      insertTestSession('s2', { label: 'myproject (2)' });
      insertTestSession('s3', { label: 'other' });
      const labels = findConflictingLabels('myproject');
      expect(labels).toHaveLength(2);
      expect(labels).toContain('myproject');
      expect(labels).toContain('myproject (2)');
    });
  });

  describe('getTrackedClaudeSessionIds', () => {
    it('returns set of non-null claude session IDs', () => {
      insertTestSession('s1', { claude_session_id: 'a' });
      insertTestSession('s2', { claude_session_id: 'b' });
      insertTestSession('s3');
      const ids = getTrackedClaudeSessionIds();
      expect(ids.size).toBe(2);
      expect(ids.has('a')).toBe(true);
      expect(ids.has('b')).toBe(true);
    });
  });

  describe('getEndedSessionIds', () => {
    it('returns only ended session IDs', () => {
      insertTestSession('s1', { status: 'ended' });
      insertTestSession('s2', { status: 'active' });
      insertTestSession('s3', { status: 'ended' });
      const ids = getEndedSessionIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('s1');
      expect(ids).toContain('s3');
    });
  });

  describe('getEmptyEndedSessionIds', () => {
    it('returns ended claude sessions with no claude_session_id', () => {
      insertTestSession('s1', { status: 'ended', session_type: 'claude' });
      insertTestSession('s2', { status: 'ended', session_type: 'claude', claude_session_id: 'x' });
      insertTestSession('s3', { status: 'ended', session_type: 'gemini' });
      insertTestSession('s4', { status: 'active', session_type: 'claude' });
      const ids = getEmptyEndedSessionIds();
      expect(ids).toEqual(['s1']);
    });
  });

  describe('getActiveTerminalSessionIds', () => {
    it('returns active terminal session IDs', () => {
      insertTestSession('s1', { status: 'active', session_type: 'terminal' });
      insertTestSession('s2', { status: 'ended', session_type: 'terminal' });
      insertTestSession('s3', { status: 'active', session_type: 'claude' });
      const ids = getActiveTerminalSessionIds();
      expect(ids).toEqual(['s1']);
    });
  });

  describe('hasPendingTasksForSession', () => {
    it('returns false when no tasks', () => {
      insertTestSession('s1');
      expect(hasPendingTasksForSession('s1')).toBe(false);
    });

    it('returns true when pending tasks exist', () => {
      insertTestSession('s1');
      testDb.run(
        `INSERT INTO task_queue (prompt, cwd, status, target_session_id, created_at)
         VALUES ('do stuff', '/tmp', 'pending', 's1', datetime('now'))`,
      );
      expect(hasPendingTasksForSession('s1')).toBe(true);
    });
  });

  // -----------------------------------------------------------------
  // WRITE functions
  // -----------------------------------------------------------------

  describe('insertSession', () => {
    it('inserts a session retrievable by getSession', () => {
      insertSession({
        sessionId: 'new1',
        label: 'New Session',
        labelSource: 'user',
        cwd: '/home/test',
        startedAt: '2026-01-01T00:00:00.000Z',
        hookMode: 'live',
        sessionType: 'claude',
      });
      const info = getSession('new1');
      expect(info).not.toBeNull();
      expect(info!.label).toBe('New Session');
      expect(info!.status).toBe('starting');
    });

    it('applies defaults for optional fields', () => {
      insertSession({
        sessionId: 'new2',
        label: 'Minimal',
        cwd: '/tmp',
        startedAt: '2026-01-01T00:00:00.000Z',
        hookMode: 'fallback',
        sessionType: 'claude',
      });
      const row = getSessionRecord('new2')!;
      expect(row.label_source).toBe('auto');
      expect(row.auto_close).toBe(0);
      expect(row.command).toBeNull();
      expect(row.claude_session_id).toBeNull();
    });

    it('sets claudeSessionId for import', () => {
      insertSession({
        sessionId: 'imp1',
        label: 'Imported',
        cwd: '/tmp',
        startedAt: '2026-01-01T00:00:00.000Z',
        hookMode: 'live',
        sessionType: 'claude',
        claudeSessionId: 'claude-xyz',
      });
      const row = getSessionRecord('imp1')!;
      expect(row.claude_session_id).toBe('claude-xyz');
    });
  });

  describe('updateSession', () => {
    it('updates specified fields and leaves others unchanged', () => {
      insertTestSession('s1', { status: 'active', label: 'Original', model: 'opus' });
      const changes = updateSession('s1', { status: 'idle', label: 'Updated' });
      expect(changes).toBe(1);
      const row = getSessionRecord('s1')!;
      expect(row.status).toBe('idle');
      expect(row.label).toBe('Updated');
      expect(row.model).toBe('opus'); // unchanged
    });

    it('sets null values', () => {
      insertTestSession('s1', { model: 'opus' });
      updateSession('s1', { model: null });
      const row = getSessionRecord('s1')!;
      expect(row.model).toBeNull();
    });

    it('skips undefined fields', () => {
      insertTestSession('s1', { status: 'active', model: 'opus' });
      updateSession('s1', { status: 'idle', model: undefined });
      const row = getSessionRecord('s1')!;
      expect(row.status).toBe('idle');
      expect(row.model).toBe('opus');
    });

    it('returns 0 for empty update', () => {
      insertTestSession('s1');
      expect(updateSession('s1', {})).toBe(0);
    });

    it('returns 0 for non-existent session', () => {
      expect(updateSession('missing', { status: 'ended' })).toBe(0);
    });
  });

  describe('updateAutoLabel', () => {
    it('updates label when source is auto', () => {
      insertTestSession('s1', { label: 'Old', label_source: 'auto' });
      expect(updateAutoLabel('s1', 'New')).toBe(true);
      expect(getSessionRecord('s1')!.label).toBe('New');
    });

    it('does not update when source is user', () => {
      insertTestSession('s1', { label: 'Old', label_source: 'user' });
      expect(updateAutoLabel('s1', 'New')).toBe(false);
      expect(getSessionRecord('s1')!.label).toBe('Old');
    });
  });

  describe('setAgentIdIfNull', () => {
    it('sets gemini_session_id when null', () => {
      insertTestSession('s1');
      expect(setAgentIdIfNull('s1', 'gemini_session_id', 'gem-1')).toBe(true);
      expect(getSessionRecord('s1')!.gemini_session_id).toBe('gem-1');
    });

    it('does not overwrite existing value', () => {
      insertTestSession('s1', { gemini_session_id: 'existing' });
      expect(setAgentIdIfNull('s1', 'gemini_session_id', 'new')).toBe(false);
      expect(getSessionRecord('s1')!.gemini_session_id).toBe('existing');
    });
  });

  describe('deleteSessionWithEvents', () => {
    it('deletes session and its events transactionally', () => {
      insertTestSession('s1');
      testDb.run(
        `INSERT INTO events (session_id, hook_event_name, session_status, payload, created_at)
         VALUES ('s1', 'SessionStart', 'active', '{}', datetime('now'))`,
      );
      deleteSessionWithEvents('s1');
      expect(getSession('s1')).toBeNull();
      const events = testDb.exec("SELECT * FROM events WHERE session_id = 's1'");
      expect(events).toHaveLength(0);
    });
  });

  describe('deleteSessionsWithEvents', () => {
    it('deletes multiple sessions and their events', () => {
      insertTestSession('s1');
      insertTestSession('s2');
      insertTestSession('s3');
      deleteSessionsWithEvents(['s1', 's2']);
      expect(getSession('s1')).toBeNull();
      expect(getSession('s2')).toBeNull();
      expect(getSession('s3')).not.toBeNull();
    });

    it('no-ops on empty array', () => {
      insertTestSession('s1');
      deleteSessionsWithEvents([]);
      expect(getSession('s1')).not.toBeNull();
    });
  });

  describe('markAllEnded', () => {
    it('marks all non-ended/non-detached sessions as ended', () => {
      insertTestSession('s1', { status: 'active' });
      insertTestSession('s2', { status: 'idle' });
      insertTestSession('s3', { status: 'ended' });
      insertTestSession('s4', { status: 'detached' });
      markAllEnded('2026-01-01T12:00:00.000Z');
      expect(getSessionRecord('s1')!.status).toBe('ended');
      expect(getSessionRecord('s2')!.status).toBe('ended');
      expect(getSessionRecord('s3')!.status).toBe('ended'); // already ended
      expect(getSessionRecord('s4')!.status).toBe('detached'); // untouched
      expect(getSessionRecord('s1')!.ended_at).toBe('2026-01-01T12:00:00.000Z');
    });
  });

  describe('markAllDetached', () => {
    it('sets pre_detach_status and status to detached', () => {
      insertTestSession('s1', { status: 'active' });
      insertTestSession('s2', { status: 'idle' });
      insertTestSession('s3', { status: 'ended' });
      markAllDetached();
      expect(getSessionRecord('s1')!.status).toBe('detached');
      expect(getSessionRecord('s1')!.pre_detach_status).toBe('active');
      expect(getSessionRecord('s2')!.status).toBe('detached');
      expect(getSessionRecord('s2')!.pre_detach_status).toBe('idle');
      expect(getSessionRecord('s3')!.status).toBe('ended'); // untouched
    });
  });

  describe('markTerminalSessionsEnded', () => {
    it('ends active terminal sessions and returns their IDs', () => {
      insertTestSession('s1', { status: 'active', session_type: 'terminal' });
      insertTestSession('s2', { status: 'active', session_type: 'claude' });
      insertTestSession('s3', { status: 'ended', session_type: 'terminal' });
      const ids = markTerminalSessionsEnded();
      expect(ids).toEqual(['s1']);
      expect(getSessionRecord('s1')!.status).toBe('ended');
      expect(getSessionRecord('s2')!.status).toBe('active');
    });
  });

  describe('clearAllAttention', () => {
    it('clears attention and returns affected IDs', () => {
      insertTestSession('s1', { attention_level: 'action', attention_reason: 'permission' });
      insertTestSession('s2', { attention_level: 'none' });
      insertTestSession('s3', { attention_level: 'info', attention_reason: 'cost' });
      const ids = clearAllAttention();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('s1');
      expect(ids).toContain('s3');
      expect(getSessionRecord('s1')!.attention_level).toBe('none');
      expect(getSessionRecord('s1')!.attention_reason).toBeNull();
    });
  });
});
