// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const clearAllAtlasesThrottled = vi.fn();
const requestRecreateAllWebgl = vi.fn();

vi.mock('../../../../src/renderer/devtools/terminal-registry', () => ({
  clearAllAtlasesThrottled,
}));

vi.mock('../../../../src/renderer/utils/webgl-lifecycle', () => ({
  requestRecreateAllWebgl,
}));

const { installAtlasRecoveryListeners } = await import(
  '../../../../src/renderer/hooks/useTerminalAtlasRecovery'
);
const { ATLAS_RECLEAR_THROTTLE_MS, ATLAS_SWEEP_INTERVAL_MS } = await import('../../../../src/shared/constants');

const WAKE_DEBOUNCE_MS = 100;

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
    requestRecreateAllWebgl.mockReset();
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

  it('app:wake recreates WebGL contexts before clearing atlases (after debounce)', () => {
    vi.useFakeTimers();
    teardown = installAtlasRecoveryListeners();
    wake.fire();

    // Nothing fires synchronously — the wake is debounced.
    expect(requestRecreateAllWebgl).not.toHaveBeenCalled();
    expect(clearAllAtlasesThrottled).not.toHaveBeenCalled();

    vi.advanceTimersByTime(WAKE_DEBOUNCE_MS);

    expect(requestRecreateAllWebgl).toHaveBeenCalledTimes(1);
    expect(clearAllAtlasesThrottled).toHaveBeenCalledTimes(1);
    expect(clearAllAtlasesThrottled).toHaveBeenLastCalledWith(0);
    // recreate must run before the belt-and-suspenders atlas clear so capped
    // (inactive) handles get the clear after their visible siblings recreate.
    expect(requestRecreateAllWebgl.mock.invocationCallOrder[0])
      .toBeLessThan(clearAllAtlasesThrottled.mock.invocationCallOrder[0]);
  });

  it('app:wake is a no-op while document.hidden — visibility effect heals on reveal', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    teardown = installAtlasRecoveryListeners();
    wake.fire();
    vi.advanceTimersByTime(WAKE_DEBOUNCE_MS * 5);

    expect(requestRecreateAllWebgl).not.toHaveBeenCalled();
    expect(clearAllAtlasesThrottled).not.toHaveBeenCalled();
  });

  it('two wake events within the debounce window coalesce into one recreate', () => {
    vi.useFakeTimers();
    teardown = installAtlasRecoveryListeners();

    wake.fire();
    vi.advanceTimersByTime(WAKE_DEBOUNCE_MS / 2);
    wake.fire();  // unlock-screen + resume often arrive ~50ms apart
    vi.advanceTimersByTime(WAKE_DEBOUNCE_MS);

    expect(requestRecreateAllWebgl).toHaveBeenCalledTimes(1);
    expect(clearAllAtlasesThrottled).toHaveBeenCalledTimes(1);
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
    expect(requestRecreateAllWebgl).not.toHaveBeenCalled();
    expect(wake.subscriberCount()).toBe(0);
  });

  it('teardown clears a pending wake debounce timer', () => {
    vi.useFakeTimers();
    teardown = installAtlasRecoveryListeners();
    wake.fire();  // schedule the debounced recreate
    teardown();
    teardown = null;
    vi.advanceTimersByTime(WAKE_DEBOUNCE_MS * 5);

    expect(requestRecreateAllWebgl).not.toHaveBeenCalled();
    expect(clearAllAtlasesThrottled).not.toHaveBeenCalled();
  });

  it('periodic sweep does not request WebGL recreate', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    teardown = installAtlasRecoveryListeners();
    vi.advanceTimersByTime(ATLAS_SWEEP_INTERVAL_MS * 3);

    expect(clearAllAtlasesThrottled).toHaveBeenCalledTimes(3);
    expect(requestRecreateAllWebgl).not.toHaveBeenCalled();
  });

  it('does not subscribe to matchMedia (DPR is handled by xterm internals)', () => {
    const mqlSpy = vi.spyOn(window, 'matchMedia');
    teardown = installAtlasRecoveryListeners();
    expect(mqlSpy).not.toHaveBeenCalled();
  });
});
