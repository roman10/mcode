import { describe, it, expect, vi, afterEach } from 'vitest';
import { toDateKey, groupSessionsByDate } from '../../../../src/renderer/utils/date-grouping';
import { makeSession } from '../../test-factories';

describe('toDateKey', () => {
  it('formats date as YYYY-MM-DD', () => {
    expect(toDateKey(new Date('2026-03-22T15:30:00Z'))).toBe('2026-03-22');
  });

  it('zero-pads month and day', () => {
    expect(toDateKey(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
  });
});

describe('groupSessionsByDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty array for no sessions', () => {
    expect(groupSessionsByDate([])).toEqual([]);
  });

  it('groups sessions by date and labels today/yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T12:00:00Z'));

    const sessions = [
      makeSession({ sessionId: 's1', startedAt: '2026-03-22T10:00:00Z' }),
      makeSession({ sessionId: 's2', startedAt: '2026-03-22T11:00:00Z' }),
      makeSession({ sessionId: 's3', startedAt: '2026-03-21T10:00:00Z' }),
    ];

    const groups = groupSessionsByDate(sessions);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('Today');
    expect(groups[0].sessions).toHaveLength(2);
    expect(groups[1].label).toBe('Yesterday');
    expect(groups[1].sessions).toHaveLength(1);
  });

  it('sorts groups newest first', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T12:00:00Z'));

    const sessions = [
      makeSession({ sessionId: 's1', startedAt: '2026-03-10T10:00:00Z' }),
      makeSession({ sessionId: 's2', startedAt: '2026-03-22T10:00:00Z' }),
    ];

    const groups = groupSessionsByDate(sessions);
    expect(groups[0].key).toBe('2026-03-22');
    expect(groups[1].key).toBe('2026-03-10');
  });

  it('shows year for dates in a different year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T12:00:00Z'));

    const sessions = [
      makeSession({ sessionId: 's1', startedAt: '2025-12-25T10:00:00Z' }),
    ];

    const groups = groupSessionsByDate(sessions);
    expect(groups[0].label).toMatch(/Dec 25, 2025/);
  });

  it('does not show year for dates in the current year (besides today/yesterday)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T12:00:00Z'));

    const sessions = [
      makeSession({ sessionId: 's1', startedAt: '2026-01-15T10:00:00Z' }),
    ];

    const groups = groupSessionsByDate(sessions);
    // Should be "Jan 15" without year
    expect(groups[0].label).toMatch(/Jan 15$/);
  });
});
