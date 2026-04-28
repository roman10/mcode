import { describe, it, expect } from 'vitest';
import { enumerateDates, localDateStr } from '../../../src/main/trackers/date-utils';

describe('enumerateDates', () => {
  it('returns a single date when start equals end', () => {
    expect(enumerateDates('2025-03-15', '2025-03-15')).toEqual(['2025-03-15']);
  });

  it('enumerates inclusive endpoints', () => {
    expect(enumerateDates('2025-03-15', '2025-03-18')).toEqual([
      '2025-03-15',
      '2025-03-16',
      '2025-03-17',
      '2025-03-18',
    ]);
  });

  it('crosses month boundaries with correct day counts', () => {
    expect(enumerateDates('2025-01-30', '2025-02-02')).toEqual([
      '2025-01-30',
      '2025-01-31',
      '2025-02-01',
      '2025-02-02',
    ]);
  });

  it('handles February in a non-leap year', () => {
    const result = enumerateDates('2025-02-26', '2025-03-02');
    expect(result).toEqual(['2025-02-26', '2025-02-27', '2025-02-28', '2025-03-01', '2025-03-02']);
  });

  it('handles February in a leap year (2024)', () => {
    const result = enumerateDates('2024-02-27', '2024-03-01');
    expect(result).toEqual(['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01']);
  });

  it('crosses a year boundary', () => {
    expect(enumerateDates('2024-12-30', '2025-01-02')).toEqual([
      '2024-12-30',
      '2024-12-31',
      '2025-01-01',
      '2025-01-02',
    ]);
  });

  it('survives the spring-forward DST transition (US)', () => {
    // 2025-03-09 02:00 → 03:00 in US time zones. The loop adds 1 calendar
    // day per iteration; if we accidentally used UTC arithmetic or hit an
    // hour-overflow bug, this would emit 2025-03-08 twice or skip a day.
    const dates = enumerateDates('2025-03-08', '2025-03-10');
    expect(dates).toEqual(['2025-03-08', '2025-03-09', '2025-03-10']);
  });

  it('survives the fall-back DST transition (US)', () => {
    // 2025-11-02 02:00 → 01:00 in US time zones.
    const dates = enumerateDates('2025-11-01', '2025-11-03');
    expect(dates).toEqual(['2025-11-01', '2025-11-02', '2025-11-03']);
  });

  it('returns empty when end precedes start', () => {
    expect(enumerateDates('2025-03-18', '2025-03-15')).toEqual([]);
  });

  it('produces a full calendar year (365 days, non-leap)', () => {
    const dates = enumerateDates('2025-01-01', '2025-12-31');
    expect(dates.length).toBe(365);
    expect(dates[0]).toBe('2025-01-01');
    expect(dates[dates.length - 1]).toBe('2025-12-31');
  });

  it('produces a full calendar year (366 days, leap)', () => {
    const dates = enumerateDates('2024-01-01', '2024-12-31');
    expect(dates.length).toBe(366);
  });

  it('every yielded date round-trips through localDateStr', () => {
    // Sanity: each entry parses back to the same string when re-formatted.
    const dates = enumerateDates('2025-02-25', '2025-03-05');
    for (const d of dates) {
      const [y, m, day] = d.split('-').map(Number);
      expect(localDateStr(new Date(y, m - 1, day))).toBe(d);
    }
  });
});
