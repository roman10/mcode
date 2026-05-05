// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const clearAllAtlasesThrottled = vi.fn();

vi.mock('../../../../src/renderer/devtools/terminal-registry', () => ({
  clearAllAtlasesThrottled,
}));

const { installAtlasRecoveryListeners } = await import(
  '../../../../src/renderer/hooks/useTerminalAtlasRecovery'
);
const { ATLAS_RECLEAR_THROTTLE_MS } = await import('../../../../src/shared/constants');

type WakeCb = () => void;
function installWakeShim(): {
  fire: () => void;
  cleanup: () => void;
  subscriberCount: () => number;
} {
  let cb: WakeCb | null = null;
  const original = (window as unknown as { mcode?: unknown }).mcode;
  (window as unknown as { mcode: unknown }).mcode = {
    app: {
      onWake: (next: WakeCb): (() => void) => {
        cb = next;
        return () => { cb = null; };
      },
    },
  };
  return {
    fire: () => cb?.(),
    cleanup: () => {
      (window as unknown as { mcode?: unknown }).mcode = original;
    },
    subscriberCount: () => (cb ? 1 : 0),
  };
}

describe('useTerminalAtlasRecovery / installAtlasRecoveryListeners', () => {
  let wake: ReturnType<typeof installWakeShim>;
  let teardown: (() => void) | null = null;

  beforeEach(() => {
    clearAllAtlasesThrottled.mockReset();
    wake = installWakeShim();
  });

  afterEach(() => {
    teardown?.();
    teardown = null;
    wake.cleanup();
  });

  it('window focus invokes clearAllAtlasesThrottled with the configured threshold', () => {
    teardown = installAtlasRecoveryListeners();
    window.dispatchEvent(new Event('focus'));

    expect(clearAllAtlasesThrottled).toHaveBeenCalledTimes(1);
    expect(clearAllAtlasesThrottled).toHaveBeenLastCalledWith(ATLAS_RECLEAR_THROTTLE_MS);
  });

  it('app:wake invokes clearAllAtlasesThrottled with threshold 0 (always clear)', () => {
    teardown = installAtlasRecoveryListeners();
    wake.fire();

    expect(clearAllAtlasesThrottled).toHaveBeenCalledTimes(1);
    expect(clearAllAtlasesThrottled).toHaveBeenLastCalledWith(0);
  });

  it('teardown removes all listeners', () => {
    teardown = installAtlasRecoveryListeners();
    teardown();
    teardown = null;

    window.dispatchEvent(new Event('focus'));
    wake.fire();

    expect(clearAllAtlasesThrottled).not.toHaveBeenCalled();
    expect(wake.subscriberCount()).toBe(0);
  });

  it('does not subscribe to visibilitychange or matchMedia', () => {
    // Recovery now relies on window focus + per-terminal container focus
    // (handled in TerminalInstance), not on visibilitychange or DPR matchMedia.
    // Spy on addEventListener and matchMedia to confirm we don't bind them.
    const docSpy = vi.spyOn(document, 'addEventListener');
    const mqlSpy = vi.spyOn(window, 'matchMedia');

    teardown = installAtlasRecoveryListeners();

    expect(docSpy).not.toHaveBeenCalledWith('visibilitychange', expect.anything());
    expect(mqlSpy).not.toHaveBeenCalled();

    docSpy.mockRestore();
    mqlSpy.mockRestore();
  });
});
