import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { Database } from 'sql.js';
import { createTestDb } from './test-db';
import { SessionEventStore } from '../../../src/main/session/session-event-store';
import type { HookEvent } from '../../../src/shared/types';

let testDb: Database;

/**
 * Minimal wrapper to make sql.js Database look like better-sqlite3 for SessionEventStore tests.
 */
function wrapDatabase(sqlDb: Database) {
  return {
    prepare: (sql: string) => {
      const stmt = sqlDb.prepare(sql);
      return {
        run: (...args: any[]) => {
          // better-sqlite3 supports .run(arg1, arg2, ...) OR .run([arg1, arg2, ...])
          const params = (args.length === 1 && Array.isArray(args[0]) ? args[0] : args).map((v: any) => v === undefined ? null : v);
          stmt.bind(params);
          stmt.step();
          const changes = sqlDb.getRowsModified();
          stmt.reset();
          stmt.free();
          return { changes };
        },
        all: (...args: any[]) => {
          const params = (args.length === 1 && Array.isArray(args[0]) ? args[0] : args).map((v: any) => v === undefined ? null : v);
          stmt.bind(params);
          const rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.reset();
          stmt.free();
          return rows;
        },
      };
    },
  };
}

vi.mock('../../../src/main/db', () => ({
  getDb: vi.fn(() => wrapDatabase(testDb)),
}));

describe('SessionEventStore', () => {
  let store: SessionEventStore;
  const MAX_BYTES = 100;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(() => {
    testDb.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    testDb.run('DELETE FROM events');
    testDb.run('DELETE FROM sessions');
    
    // Insert a test session for foreign key constraint
    testDb.run(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, hook_mode)
       VALUES ('s1', 'test', '/tmp', 'active', datetime('now'), 'claude', 'live')`,
    );
    
    store = new SessionEventStore(MAX_BYTES);
  });

  it('persists an event with truncated tool input if it exceeds max bytes', () => {
    const largeInput = { data: 'x'.repeat(200) };
    const event: HookEvent = {
      sessionId: 's1',
      claudeSessionId: 'c1',
      hookEventName: 'PreToolUse',
      toolName: 'Bash',
      toolInput: largeInput,
      createdAt: '2026-03-28T10:00:00Z',
      payload: { foo: 'bar' },
    };

    store.persistEvent('s1', event, 'active');

    const events = store.getRecentEvents('s1');
    expect(events).toHaveLength(1);
    expect(events[0].toolInput).toEqual({
      _truncated: true,
      _originalLength: JSON.stringify(largeInput).length,
    });
  });

  it('persists an event without truncation if tool input is small', () => {
    const smallInput = { data: 'small' };
    const event: HookEvent = {
      sessionId: 's1',
      claudeSessionId: 'c1',
      hookEventName: 'PreToolUse',
      toolName: 'Bash',
      toolInput: smallInput,
      createdAt: '2026-03-28T10:00:00Z',
      payload: { foo: 'bar' },
    };

    store.persistEvent('s1', event, 'active');

    const events = store.getRecentEvents('s1');
    expect(events).toHaveLength(1);
    expect(events[0].toolInput).toEqual(smallInput);
  });

  it('getRecentEvents returns correct number of events and handles limit', () => {
    for (let i = 0; i < 5; i++) {
      store.persistEvent('s1', {
        sessionId: 's1',
        hookEventName: 'PreToolUse',
        createdAt: `2026-03-28T10:00:0${i}Z`,
        payload: { i },
      }, 'active');
    }

    expect(store.getRecentEvents('s1')).toHaveLength(5);
    expect(store.getRecentEvents('s1', 3)).toHaveLength(3);
    // Ordered by newest first
    expect(store.getRecentEvents('s1')[0].payload).toEqual({ i: 4 });
  });

  it('getRecentAllEvents returns events across all sessions', () => {
    testDb.run(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, hook_mode)
       VALUES ('s2', 'test2', '/tmp', 'active', datetime('now'), 'claude', 'live')`,
    );

    store.persistEvent('s1', { sessionId: 's1', hookEventName: 'E1', createdAt: 'T1', payload: {} }, 'active');
    store.persistEvent('s2', { sessionId: 's2', hookEventName: 'E2', createdAt: 'T2', payload: {} }, 'active');

    const all = store.getRecentAllEvents();
    expect(all).toHaveLength(2);
    const sessionIds = all.map(e => e.sessionId);
    expect(sessionIds).toContain('s1');
    expect(sessionIds).toContain('s2');
  });

  it('clearAllEvents deletes all rows from events table', () => {
    store.persistEvent('s1', { sessionId: 's1', hookEventName: 'E1', createdAt: 'T1', payload: {} }, 'active');
    expect(store.getRecentAllEvents()).toHaveLength(1);

    store.clearAllEvents();
    expect(store.getRecentAllEvents()).toHaveLength(0);
  });

  it('pruneOldEvents deletes rows older than retention period', () => {
    vi.useFakeTimers();
    // Retention is likely 30 days based on mcode defaults
    const now = new Date('2026-05-01T12:00:00Z');
    vi.setSystemTime(now);

    const oldDate = new Date('2026-04-20T12:00:00Z').toISOString();
    const newDate = new Date('2026-04-28T12:00:00Z').toISOString();

    store.persistEvent('s1', { sessionId: 's1', hookEventName: 'OLD', createdAt: oldDate, payload: {} }, 'active');
    store.persistEvent('s1', { sessionId: 's1', hookEventName: 'NEW', createdAt: newDate, payload: {} }, 'active');

    expect(store.getRecentAllEvents()).toHaveLength(2);
    
    store.pruneOldEvents();
    
    const remaining = store.getRecentAllEvents();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].hookEventName).toBe('NEW');
  });
});
