// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const requestRecreateAllWebgl = vi.fn();

vi.mock('../../../../src/renderer/utils/webgl-lifecycle', () => ({
  requestRecreateAllWebgl,
}));

const { installAtlasRecoveryListeners } = await import(
  '../../../../src/renderer/hooks/useTerminalAtlasRecovery'
);

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
    requestRecreateAllWebgl.mockReset();
    wake = installWakeShim();
  });

  afterEach(() => {
    teardown?.();
    teardown = null;
    wake.cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (document as unknown as { hidden?: boolean }).hidden;
  });

  it('app:wake recreates WebGL contexts after the debounce', () => {
    vi.useFakeTimers();
    teardown = installAtlasRecoveryListeners();
    wake.fire();

    // Nothing fires synchronously — the wake is debounced.
    expect(requestRecreateAllWebgl).not.toHaveBeenCalled();

    vi.advanceTimersByTime(WAKE_DEBOUNCE_MS);

    expect(requestRecreateAllWebgl).toHaveBeenCalledTimes(1);
  });

  it('app:wake is a no-op while document.hidden — visibility effect heals on reveal', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    teardown = installAtlasRecoveryListeners();
    wake.fire();
    vi.advanceTimersByTime(WAKE_DEBOUNCE_MS * 5);

    expect(requestRecreateAllWebgl).not.toHaveBeenCalled();
  });

  it('two wake events within the debounce window coalesce into one recreate', () => {
    vi.useFakeTimers();
    teardown = installAtlasRecoveryListeners();

    wake.fire();
    vi.advanceTimersByTime(WAKE_DEBOUNCE_MS / 2);
    wake.fire();  // unlock-screen + resume often arrive ~50ms apart
    vi.advanceTimersByTime(WAKE_DEBOUNCE_MS);

    expect(requestRecreateAllWebgl).toHaveBeenCalledTimes(1);
  });

  it('does not clear atlases on window focus or visibilitychange (private atlases — no shared atlas to sweep)', () => {
    teardown = installAtlasRecoveryListeners();

    window.dispatchEvent(new Event('focus'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));

    // The only recovery is the wake-driven context recreate; nothing here.
    expect(requestRecreateAllWebgl).not.toHaveBeenCalled();
  });

  it('runs no periodic sweep', () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    teardown = installAtlasRecoveryListeners();

    // Previously a 60s sweep fired here; with private atlases there is none.
    vi.advanceTimersByTime(60_000 * 5);
    expect(requestRecreateAllWebgl).not.toHaveBeenCalled();
  });

  it('teardown removes the wake listener', () => {
    vi.useFakeTimers();
    teardown = installAtlasRecoveryListeners();
    teardown();
    teardown = null;

    wake.fire();
    vi.advanceTimersByTime(WAKE_DEBOUNCE_MS * 2);

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
  });

  it('does not subscribe to matchMedia (DPR is handled by xterm internals)', () => {
    const mqlSpy = vi.spyOn(window, 'matchMedia');
    teardown = installAtlasRecoveryListeners();
    expect(mqlSpy).not.toHaveBeenCalled();
  });
});
