import { describe, it, expect } from 'vitest';
import { normalizeModelVersion, normalizeModelFamily, estimateCostUsd } from '../../../src/main/trackers/token-cost';

describe('normalizeModelVersion', () => {
  it('strips claude- prefix and date suffix', () => {
    expect(normalizeModelVersion('claude-opus-4-6')).toBe('opus-4.6');
    expect(normalizeModelVersion('claude-sonnet-4-5-20251022')).toBe('sonnet-4.5');
    expect(normalizeModelVersion('claude-haiku-4-5')).toBe('haiku-4.5');
  });

  it('handles single-segment versions', () => {
    expect(normalizeModelVersion('claude-opus-4')).toBe('opus-4');
    expect(normalizeModelVersion('claude-sonnet-4')).toBe('sonnet-4');
  });

  it('handles bare family names', () => {
    expect(normalizeModelVersion('claude-opus')).toBe('opus');
    expect(normalizeModelVersion('claude-sonnet')).toBe('sonnet');
  });

  it('returns unknown models as-is after stripping prefix', () => {
    expect(normalizeModelVersion('claude-unknown-model')).toBe('unknown-model');
    expect(normalizeModelVersion('gpt-4')).toBe('gpt-4');
  });

  it('handles haiku versions', () => {
    expect(normalizeModelVersion('claude-haiku-3-5')).toBe('haiku-3.5');
    expect(normalizeModelVersion('claude-haiku-3')).toBe('haiku-3');
  });
});

describe('normalizeModelFamily', () => {
  it('detects opus', () => {
    expect(normalizeModelFamily('claude-opus-4-6')).toBe('opus');
    expect(normalizeModelFamily('Claude-Opus-4')).toBe('opus');
  });

  it('detects sonnet', () => {
    expect(normalizeModelFamily('claude-sonnet-4-5-20251022')).toBe('sonnet');
  });

  it('detects haiku', () => {
    expect(normalizeModelFamily('claude-haiku-3-5')).toBe('haiku');
  });

  it('returns unknown for unrecognized models', () => {
    expect(normalizeModelFamily('gpt-4')).toBe('unknown');
    expect(normalizeModelFamily('')).toBe('unknown');
  });
});

describe('estimateCostUsd', () => {
  it('calculates basic input/output cost', () => {
    // opus-4.6: input $5/MTok, output $25/MTok
    const cost = estimateCostUsd('claude-opus-4-6', 1_000_000, 1_000_000, 0, 0, 0, false);
    expect(cost).toBe(30); // $5 + $25
  });

  it('applies fast mode multiplier', () => {
    const normal = estimateCostUsd('claude-opus-4-6', 1_000_000, 0, 0, 0, 0, false);
    const fast = estimateCostUsd('claude-opus-4-6', 1_000_000, 0, 0, 0, 0, true);
    expect(fast).toBe(normal * 6);
  });

  it('accounts for cache write 5m (1.25x input price)', () => {
    // sonnet-4.5: input $3/MTok
    const cost = estimateCostUsd('claude-sonnet-4-5', 0, 0, 1_000_000, 0, 0, false);
    expect(cost).toBe(3 * 1.25); // $3.75
  });

  it('accounts for cache write 1h (2x input price)', () => {
    const cost = estimateCostUsd('claude-sonnet-4-5', 0, 0, 0, 1_000_000, 0, false);
    expect(cost).toBe(3 * 2); // $6
  });

  it('accounts for cache read (0.1x input price)', () => {
    const cost = estimateCostUsd('claude-sonnet-4-5', 0, 0, 0, 0, 1_000_000, false);
    expect(cost).toBe(0.3);
  });

  it('returns 0 for unknown models', () => {
    expect(estimateCostUsd('gpt-4', 1_000_000, 1_000_000, 0, 0, 0, false)).toBe(0);
  });

  it('returns 0 for zero tokens', () => {
    expect(estimateCostUsd('claude-opus-4-6', 0, 0, 0, 0, 0, false)).toBe(0);
  });

  it('rounds to 6 decimal places', () => {
    // Small token counts should produce a cleanly rounded result
    const cost = estimateCostUsd('claude-haiku-3', 100, 0, 0, 0, 0, false);
    // 100 * 0.25 / 1_000_000 = 0.000025
    expect(cost).toBe(0.000025);
    const parts = cost.toString().split('.');
    expect((parts[1] || '').length).toBeLessThanOrEqual(6);
  });
});
