import { describe, it, expect } from 'vitest';
import { markFresh, consumeFresh } from '../../../../src/renderer/utils/fresh-sessions';

describe('fresh-sessions', () => {
  it('returns true on the first consume after markFresh, false thereafter', () => {
    const id = 'session-' + Math.random();
    markFresh(id);
    expect(consumeFresh(id)).toBe(true);
    expect(consumeFresh(id)).toBe(false);
  });

  it('returns false for an unmarked session', () => {
    expect(consumeFresh('session-' + Math.random())).toBe(false);
  });

  it('treats each session id independently', () => {
    const a = 'a-' + Math.random();
    const b = 'b-' + Math.random();
    markFresh(a);
    markFresh(b);
    expect(consumeFresh(a)).toBe(true);
    expect(consumeFresh(b)).toBe(true);
    expect(consumeFresh(a)).toBe(false);
    expect(consumeFresh(b)).toBe(false);
  });

  it('marking twice is idempotent', () => {
    const id = 'dup-' + Math.random();
    markFresh(id);
    markFresh(id);
    expect(consumeFresh(id)).toBe(true);
    expect(consumeFresh(id)).toBe(false);
  });
});
