import { describe, it, expect } from 'vitest';
import { getOrderedVisibleSessions, getOrderedOpenSessions } from '../../../../src/renderer/utils/session-ordering';
import { makeSession } from '../../test-factories';

describe('getOrderedVisibleSessions', () => {
  it('filters out terminal sessions (they live in the bottom panel)', () => {
    const sessions = {
      s1: makeSession({ sessionId: 's1', sessionType: 'claude' }),
      s2: makeSession({ sessionId: 's2', sessionType: 'terminal' }),
    };
    const result = getOrderedVisibleSessions(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe('s1');
  });

  it('sorts by attention level: action > info > none', () => {
    const sessions = {
      s1: makeSession({ sessionId: 's1', attentionLevel: 'none' }),
      s2: makeSession({ sessionId: 's2', attentionLevel: 'action' }),
      s3: makeSession({ sessionId: 's3', attentionLevel: 'info' }),
    };
    const result = getOrderedVisibleSessions(sessions);
    expect(result.map((s) => s.attentionLevel)).toEqual(['action', 'info', 'none']);
  });

  it('sorts by status within same attention level', () => {
    const sessions = {
      s1: makeSession({ sessionId: 's1', attentionLevel: 'none', status: 'ended' }),
      s2: makeSession({ sessionId: 's2', attentionLevel: 'none', status: 'active' }),
      s3: makeSession({ sessionId: 's3', attentionLevel: 'none', status: 'waiting' }),
    };
    const result = getOrderedVisibleSessions(sessions);
    // waiting (0) < active (1) < ended (5)
    expect(result.map((s) => s.status)).toEqual(['waiting', 'active', 'ended']);
  });

  it('sorts by startedAt (newest first) within same attention and status', () => {
    const sessions = {
      s1: makeSession({ sessionId: 's1', startedAt: '2026-03-20T10:00:00Z' }),
      s2: makeSession({ sessionId: 's2', startedAt: '2026-03-22T10:00:00Z' }),
      s3: makeSession({ sessionId: 's3', startedAt: '2026-03-21T10:00:00Z' }),
    };
    const result = getOrderedVisibleSessions(sessions);
    expect(result.map((s) => s.sessionId)).toEqual(['s2', 's3', 's1']);
  });

  it('returns empty array for empty input', () => {
    expect(getOrderedVisibleSessions({})).toEqual([]);
  });

  it('combines all sort criteria correctly', () => {
    const sessions = {
      // action + active (newest) → first
      s1: makeSession({ sessionId: 's1', attentionLevel: 'action', status: 'active', startedAt: '2026-03-22T10:00:00Z' }),
      // action + active (older) → second
      s2: makeSession({ sessionId: 's2', attentionLevel: 'action', status: 'active', startedAt: '2026-03-20T10:00:00Z' }),
      // none + active → third
      s3: makeSession({ sessionId: 's3', attentionLevel: 'none', status: 'active', startedAt: '2026-03-22T10:00:00Z' }),
      // terminal → filtered
      s4: makeSession({ sessionId: 's4', sessionType: 'terminal' }),
    };
    const result = getOrderedVisibleSessions(sessions);
    expect(result.map((s) => s.sessionId)).toEqual(['s1', 's2', 's3']);
  });
});

describe('getOrderedOpenSessions', () => {
  it('excludes ended sessions', () => {
    const sessions = {
      s1: makeSession({ sessionId: 's1', status: 'active' }),
      s2: makeSession({ sessionId: 's2', status: 'ended' }),
      s3: makeSession({ sessionId: 's3', status: 'idle' }),
    };
    const result = getOrderedOpenSessions(sessions);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.sessionId)).not.toContain('s2');
  });

  it('returns empty array when all sessions are ended', () => {
    const sessions = {
      s1: makeSession({ sessionId: 's1', status: 'ended' }),
      s2: makeSession({ sessionId: 's2', status: 'ended' }),
    };
    expect(getOrderedOpenSessions(sessions)).toEqual([]);
  });

  it('preserves canonical sort order', () => {
    const sessions = {
      s1: makeSession({ sessionId: 's1', attentionLevel: 'none', status: 'active' }),
      s2: makeSession({ sessionId: 's2', attentionLevel: 'action', status: 'waiting' }),
      s3: makeSession({ sessionId: 's3', status: 'ended' }),
    };
    const result = getOrderedOpenSessions(sessions);
    expect(result.map((s) => s.sessionId)).toEqual(['s2', 's1']);
  });

  it('returns empty array for empty input', () => {
    expect(getOrderedOpenSessions({})).toEqual([]);
  });
});
