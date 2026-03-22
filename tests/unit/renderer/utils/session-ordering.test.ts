import { describe, it, expect } from 'vitest';
import { getOrderedVisibleSessions } from '../../../../src/renderer/utils/session-ordering';
import { makeSession } from '../../test-factories';

describe('getOrderedVisibleSessions', () => {
  it('filters out ephemeral sessions', () => {
    const sessions = {
      s1: makeSession({ sessionId: 's1', ephemeral: false }),
      s2: makeSession({ sessionId: 's2', ephemeral: true }),
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

  it('returns empty array when all sessions are ephemeral', () => {
    const sessions = {
      s1: makeSession({ sessionId: 's1', ephemeral: true }),
    };
    expect(getOrderedVisibleSessions(sessions)).toEqual([]);
  });

  it('combines all sort criteria correctly', () => {
    const sessions = {
      // action + active (newest) → first
      s1: makeSession({ sessionId: 's1', attentionLevel: 'action', status: 'active', startedAt: '2026-03-22T10:00:00Z' }),
      // action + active (older) → second
      s2: makeSession({ sessionId: 's2', attentionLevel: 'action', status: 'active', startedAt: '2026-03-20T10:00:00Z' }),
      // none + active → third
      s3: makeSession({ sessionId: 's3', attentionLevel: 'none', status: 'active', startedAt: '2026-03-22T10:00:00Z' }),
      // ephemeral → filtered
      s4: makeSession({ sessionId: 's4', ephemeral: true }),
    };
    const result = getOrderedVisibleSessions(sessions);
    expect(result.map((s) => s.sessionId)).toEqual(['s1', 's2', 's3']);
  });
});
