import { describe, expect, it } from 'vitest';
import { parseUsageResponse } from '../../../../src/main/claude-subscription-fetcher';

describe('parseUsageResponse', () => {
  it('parses the limits[] array including a per-model scoped weekly limit (Fable)', () => {
    // Shape captured live from https://api.anthropic.com/api/oauth/usage.
    const raw = {
      five_hour: { utilization: 70, resets_at: '2026-07-06T11:00:00Z' },
      seven_day: { utilization: 30, resets_at: '2026-07-09T10:00:00Z' },
      seven_day_opus: null,
      limits: [
        { kind: 'session', group: 'session', percent: 70, resets_at: '2026-07-06T11:00:00Z', scope: null, is_active: true },
        { kind: 'weekly_all', group: 'weekly', percent: 30, resets_at: '2026-07-09T10:00:00Z', scope: null, is_active: false },
        {
          kind: 'weekly_scoped',
          group: 'weekly',
          percent: 20,
          resets_at: '2026-07-09T10:00:00Z',
          scope: { model: { id: null, display_name: 'Fable' }, surface: null },
          is_active: false,
        },
      ],
    };

    expect(parseUsageResponse(raw)).toEqual([
      { id: 'five-hour', label: '5-hour', utilization: 70, resetsAt: '2026-07-06T11:00:00Z', kind: 'session' },
      { id: 'seven-day', label: '7-day', utilization: 30, resetsAt: '2026-07-09T10:00:00Z', kind: 'weekly_all' },
      { id: 'seven-day-fable', label: 'Fable', utilization: 20, resetsAt: '2026-07-09T10:00:00Z', kind: 'weekly_scoped' },
    ]);
  });

  it('skips limits with unknown kinds or missing percent', () => {
    const raw = {
      limits: [
        { kind: 'session', percent: 12, resets_at: null },
        { kind: 'mystery_future_kind', percent: 99, resets_at: null },
        { kind: 'weekly_scoped', percent: null, scope: { model: { display_name: 'Opus' } } },
      ],
    };

    expect(parseUsageResponse(raw)).toEqual([
      { id: 'five-hour', label: '5-hour', utilization: 12, resetsAt: null, kind: 'session' },
    ]);
  });

  it('falls back to legacy flat keys when limits[] is absent', () => {
    const raw = {
      five_hour: { utilization: 55, resets_at: '2026-07-06T11:00:00Z' },
      seven_day: { utilization: 40, resets_at: '2026-07-09T10:00:00Z' },
      seven_day_opus: { utilization: 10, resets_at: '2026-07-09T10:00:00Z' },
    };

    expect(parseUsageResponse(raw)).toEqual([
      { id: 'five-hour', label: '5-hour', utilization: 55, resetsAt: '2026-07-06T11:00:00Z', kind: null },
      { id: 'seven-day', label: '7-day', utilization: 40, resetsAt: '2026-07-09T10:00:00Z', kind: null },
      { id: 'seven-day-opus', label: 'Opus', utilization: 10, resetsAt: '2026-07-09T10:00:00Z', kind: null },
    ]);
  });

  it('falls back to legacy flat keys when limits[] is present but empty', () => {
    const raw = {
      five_hour: { utilization: 5, resets_at: null },
      seven_day: null,
      seven_day_opus: null,
      limits: [],
    };

    expect(parseUsageResponse(raw)).toEqual([
      { id: 'five-hour', label: '5-hour', utilization: 5, resetsAt: null, kind: null },
    ]);
  });

  it('returns an empty list for garbage or empty input', () => {
    expect(parseUsageResponse(null)).toEqual([]);
    expect(parseUsageResponse('nope')).toEqual([]);
    expect(parseUsageResponse({})).toEqual([]);
  });

  it('labels a scoped weekly limit generically when display_name is missing', () => {
    const raw = { limits: [{ kind: 'weekly_scoped', percent: 33, resets_at: null, scope: { model: {} } }] };

    expect(parseUsageResponse(raw)).toEqual([
      { id: 'seven-day-scoped', label: 'Weekly (scoped)', utilization: 33, resetsAt: null, kind: 'weekly_scoped' },
    ]);
  });
});
