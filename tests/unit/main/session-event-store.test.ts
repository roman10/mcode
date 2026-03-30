import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { getDb, resetDbForTest } from '../../../src/main/db';
import { SessionEventStore } from '../../../src/main/session/session-event-store';
import type { HookEvent } from '../../../src/shared/types';

describe('SessionEventStore', () => {
  let store: SessionEventStore;
  const MAX_BYTES = 100;

  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    const db = getDb();
    db.prepare('DELETE FROM events').run();
    db.prepare('DELETE FROM sessions').run();
    
    // Insert a test session for foreign key constraint
    db.prepare(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, hook_mode)
       VALUES ('s1', 'test', '/tmp', 'active', datetime('now'), 'claude', 'live')`,
    ).run();
    
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
    getDb().prepare(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, hook_mode)
       VALUES ('s2', 'test2', '/tmp', 'active', datetime('now'), 'claude', 'live')`,
    ).run();

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
