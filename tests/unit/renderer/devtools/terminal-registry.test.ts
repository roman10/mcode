// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  terminalRegistry,
  clearAtlasThrottled,
  clearAllAtlasesThrottled,
  forgetAtlasClear,
  forgetAllAtlasClears,
} from '../../../../src/renderer/devtools/terminal-registry';

function fakeTerm(): { clearTextureAtlas: ReturnType<typeof vi.fn> } {
  return { clearTextureAtlas: vi.fn() };
}

describe('terminal-registry atlas throttle helpers', () => {
  beforeEach(() => {
    terminalRegistry.clear();
    forgetAllAtlasClears();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    terminalRegistry.clear();
    forgetAllAtlasClears();
  });

  describe('clearAtlasThrottled', () => {
    it('clears once and no-ops within the threshold window', () => {
      const t = fakeTerm();
      terminalRegistry.set('s1', t as never);

      expect(clearAtlasThrottled('s1', 2000)).toBe(true);
      expect(t.clearTextureAtlas).toHaveBeenCalledTimes(1);

      vi.setSystemTime(1_000_000 + 1_999);
      expect(clearAtlasThrottled('s1', 2000)).toBe(false);
      expect(t.clearTextureAtlas).toHaveBeenCalledTimes(1);

      vi.setSystemTime(1_000_000 + 2_000);
      expect(clearAtlasThrottled('s1', 2000)).toBe(true);
      expect(t.clearTextureAtlas).toHaveBeenCalledTimes(2);
    });

    it('threshold 0 always clears', () => {
      const t = fakeTerm();
      terminalRegistry.set('s1', t as never);

      expect(clearAtlasThrottled('s1', 0)).toBe(true);
      expect(clearAtlasThrottled('s1', 0)).toBe(true);
      expect(clearAtlasThrottled('s1', 0)).toBe(true);
      expect(t.clearTextureAtlas).toHaveBeenCalledTimes(3);
    });

    it('returns false and prunes stale timestamp when session is unknown', () => {
      // Seed a timestamp by registering, clearing, then unregistering.
      const t = fakeTerm();
      terminalRegistry.set('ghost', t as never);
      clearAtlasThrottled('ghost', 0);
      terminalRegistry.delete('ghost');

      // Subsequent throttled call should return false and not throw.
      expect(clearAtlasThrottled('ghost', 2000)).toBe(false);

      // Re-registering and clearing again works (timestamp was pruned, so it
      // doesn't carry the prior session's stale value).
      const t2 = fakeTerm();
      terminalRegistry.set('ghost', t2 as never);
      expect(clearAtlasThrottled('ghost', 2000)).toBe(true);
      expect(t2.clearTextureAtlas).toHaveBeenCalledTimes(1);
    });

    it('survives a terminal whose clearTextureAtlas throws', () => {
      const bad = { clearTextureAtlas: vi.fn(() => { throw new Error('disposed'); }) };
      terminalRegistry.set('bad', bad as never);

      // Both calls go through the catch path (timestamp is dropped on throw,
      // so the second call is not throttled). The helper must swallow the
      // error and return false rather than propagate.
      expect(() => clearAtlasThrottled('bad', 2000)).not.toThrow();
      expect(clearAtlasThrottled('bad', 2000)).toBe(false);
      expect(bad.clearTextureAtlas).toHaveBeenCalledTimes(2);
    });

    it('shared timestamp: a clear via threshold 0 still gates a subsequent throttled call', () => {
      const t = fakeTerm();
      terminalRegistry.set('s1', t as never);

      // Resize-style clear (threshold 0): always clears, but updates timestamp.
      expect(clearAtlasThrottled('s1', 0)).toBe(true);

      // 1 ms later, a focus-style clear (threshold 2000) should no-op.
      vi.setSystemTime(1_000_000 + 1);
      expect(clearAtlasThrottled('s1', 2000)).toBe(false);
      expect(t.clearTextureAtlas).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearAllAtlasesThrottled', () => {
    it('honors per-terminal timestamps independently', () => {
      const a = fakeTerm();
      const b = fakeTerm();
      terminalRegistry.set('a', a as never);
      terminalRegistry.set('b', b as never);

      // Pre-clear `a` so its throttle is fresh; `b` has no timestamp.
      clearAtlasThrottled('a', 0);
      expect(a.clearTextureAtlas).toHaveBeenCalledTimes(1);

      vi.setSystemTime(1_000_000 + 1_000);
      const cleared = clearAllAtlasesThrottled(2000);

      // a: throttled (1s < 2s), b: cleared.
      expect(cleared).toBe(1);
      expect(a.clearTextureAtlas).toHaveBeenCalledTimes(1);
      expect(b.clearTextureAtlas).toHaveBeenCalledTimes(1);
    });

    it('threshold 0 clears every registered terminal', () => {
      const a = fakeTerm();
      const b = fakeTerm();
      terminalRegistry.set('a', a as never);
      terminalRegistry.set('b', b as never);

      expect(clearAllAtlasesThrottled(0)).toBe(2);
      expect(a.clearTextureAtlas).toHaveBeenCalledTimes(1);
      expect(b.clearTextureAtlas).toHaveBeenCalledTimes(1);
    });
  });

  describe('forgetAtlasClear', () => {
    it('drops the timestamp so the next clear runs immediately', () => {
      const t = fakeTerm();
      terminalRegistry.set('s1', t as never);

      clearAtlasThrottled('s1', 2000);
      expect(t.clearTextureAtlas).toHaveBeenCalledTimes(1);

      forgetAtlasClear('s1');

      // Without forgetAtlasClear, this would no-op (1ms < 2000ms).
      vi.setSystemTime(1_000_000 + 1);
      expect(clearAtlasThrottled('s1', 2000)).toBe(true);
      expect(t.clearTextureAtlas).toHaveBeenCalledTimes(2);
    });
  });
});
