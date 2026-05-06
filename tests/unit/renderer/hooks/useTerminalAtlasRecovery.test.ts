// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const clearAllAtlasesThrottled = vi.fn();

vi.mock('../../../../src/renderer/devtools/terminal-registry', () => ({
  clearAllAtlasesThrottled,
}));

const { installAtlasRecoveryListeners } = await import(
  '../../../../src/renderer/hooks/useTerminalAtlasRecovery'
);
const { ATLAS_RECLEAR_THROTTLE_MS, ATLAS_SWEEP_INTERVAL_MS } = await import('../../../../src/shared/constants');

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
    vi.useRealTimers();
    // Restore vi.spyOn instances even if a test threw before mockRestore.
    vi.restoreAllMocks();
    // Tests may install an own-property `hidden` getter on document; remove it
    // so the prototype's getter takes over again for any later test.
    delete (document as unknown as { hidden?: boolean }).hidden;
  });

  it('window focus invokes clearAllAtlasesThrottled with the configured threshold', () => {
    teardown = installAtlasRecoveryListeners();
    window.dispatchEvent(new Event('focus'));

    expect(clearAllAtlasesThrottled).toHaveBeenCalledTimes(1);
    expect(clearAllAtlasesThrottled).toHaveBeenLastCalledWith(ATLAS_RECLEAR_THROTTLE_MS);
  });

  it('visibilitychange fires the throttled fleet clear when the document becomes visible', () => {
    teardown = installAtlasRecoveryListeners();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(clearAllAtlasesThrottled).toHaveBeenCalledTimes(1);
    expect(clearAllAtlasesThrottled).toHaveBeenLastCalledWith(ATLAS_RECLEAR_THROTTLE_MS);

    // No clear when the document went hidden — only the visible transition matters.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(clearAllAtlasesThrottled).toHaveBeenCalledTimes(1);
  });

  it('app:wake invokes clearAllAtlasesThrottled with threshold 0 (always clear)', () => {
    teardown = installAtlasRecoveryListeners();
    wake.fire();

    expect(clearAllAtlasesThrottled).toHaveBeenCalledTimes(1);
    expect(clearAllAtlasesThrottled).toHaveBeenLastCalledWith(0);
  });

  it('periodic sweep clears all atlases while the window has focus', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    teardown = installAtlasRecoveryListeners();

    vi.advanceTimersByTime(ATLAS_SWEEP_INTERVAL_MS);
    expect(clearAllAtlasesThrottled).toHaveBeenCalledTimes(1);
    expect(clearAllAtlasesThrottled).toHaveBeenLastCalledWith(ATLAS_SWEEP_INTERVAL_MS);

    vi.advanceTimersByTime(ATLAS_SWEEP_INTERVAL_MS);
    expect(clearAllAtlasesThrottled).toHaveBeenCalledTimes(2);
  });

  it('periodic sweep skips when the window does not have focus', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    teardown = installAtlasRecoveryListeners();

    vi.advanceTimersByTime(ATLAS_SWEEP_INTERVAL_MS * 3);
    expect(clearAllAtlasesThrottled).not.toHaveBeenCalled();
  });

  it('teardown removes all listeners and stops the sweep', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    teardown = installAtlasRecoveryListeners();
    teardown();
    teardown = null;

    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    wake.fire();
    vi.advanceTimersByTime(ATLAS_SWEEP_INTERVAL_MS * 2);

    expect(clearAllAtlasesThrottled).not.toHaveBeenCalled();
    expect(wake.subscriberCount()).toBe(0);
  });

  it('does not subscribe to matchMedia (DPR is handled by xterm internals)', () => {
    const mqlSpy = vi.spyOn(window, 'matchMedia');
    teardown = installAtlasRecoveryListeners();
    expect(mqlSpy).not.toHaveBeenCalled();
  });
});
