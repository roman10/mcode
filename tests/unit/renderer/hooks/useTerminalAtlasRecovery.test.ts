// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../src/renderer/devtools/terminal-registry', () => ({
  terminalRegistry: new Map(),
}));

const { installAtlasRecoveryListeners } = await import(
  '../../../../src/renderer/hooks/useTerminalAtlasRecovery'
);
const { terminalRegistry } = await import(
  '../../../../src/renderer/devtools/terminal-registry'
);

function fakeTerm(): { clearTextureAtlas: ReturnType<typeof vi.fn> } {
  return { clearTextureAtlas: vi.fn() };
}

// happy-dom's matchMedia returns a real MQL but we can't fire `change` on it from
// outside, so install a shim that lets us trigger the listener directly.
type MqlListener = (e: MediaQueryListEvent) => void;
function installMatchMediaShim(): {
  fireChange: () => void;
  cleanup: () => void;
  bindCount: () => number;
} {
  let listener: MqlListener | null = null;
  let bindings = 0;
  const original = window.matchMedia;
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = (
    _query: string,
  ) => {
    bindings++;
    return {
      matches: true,
      media: _query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_event: string, cb: EventListenerOrEventListenerObject) => {
        listener = cb as MqlListener;
      },
      removeEventListener: () => {
        listener = null;
      },
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  };
  return {
    fireChange: () => listener?.({ matches: false } as MediaQueryListEvent),
    cleanup: () => {
      (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = original;
    },
    bindCount: () => bindings,
  };
}

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
  let mq: ReturnType<typeof installMatchMediaShim>;
  let wake: ReturnType<typeof installWakeShim>;
  let teardown: (() => void) | null = null;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    terminalRegistry.clear();
    mq = installMatchMediaShim();
    wake = installWakeShim();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  afterEach(() => {
    teardown?.();
    teardown = null;
    mq.cleanup();
    wake.cleanup();
    logSpy.mockRestore();
    vi.useRealTimers();
  });

  it('clears atlas on every registered terminal when visibilitychange fires while visible', () => {
    const t1 = fakeTerm();
    const t2 = fakeTerm();
    terminalRegistry.set('s1', t1 as never);
    terminalRegistry.set('s2', t2 as never);

    teardown = installAtlasRecoveryListeners();
    document.dispatchEvent(new Event('visibilitychange'));

    expect(t1.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(t2.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it('does NOT clear atlas when visibilitychange fires while document is hidden', () => {
    const t1 = fakeTerm();
    terminalRegistry.set('s1', t1 as never);

    teardown = installAtlasRecoveryListeners();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(t1.clearTextureAtlas).not.toHaveBeenCalled();
  });

  it('clears atlas on DPR change and re-binds matchMedia with the new DPR', () => {
    const t1 = fakeTerm();
    terminalRegistry.set('s1', t1 as never);

    teardown = installAtlasRecoveryListeners();
    expect(mq.bindCount()).toBe(1); // initial bind

    mq.fireChange();
    expect(t1.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(mq.bindCount()).toBe(2); // re-bound after fire

    mq.fireChange();
    expect(t1.clearTextureAtlas).toHaveBeenCalledTimes(2);
    expect(mq.bindCount()).toBe(3);
  });

  it('throttles focus-driven recovery to once per 30s', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const t1 = fakeTerm();
    terminalRegistry.set('s1', t1 as never);

    teardown = installAtlasRecoveryListeners();

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
    expect(t1.clearTextureAtlas).toHaveBeenCalledTimes(1);

    // Advance just under the throttle — still 1 call
    vi.setSystemTime(now + 29_999);
    window.dispatchEvent(new Event('focus'));
    expect(t1.clearTextureAtlas).toHaveBeenCalledTimes(1);

    // Advance past the throttle — recovery fires again
    vi.setSystemTime(now + 30_001);
    window.dispatchEvent(new Event('focus'));
    expect(t1.clearTextureAtlas).toHaveBeenCalledTimes(2);
  });

  it('teardown removes all listeners', () => {
    const t1 = fakeTerm();
    terminalRegistry.set('s1', t1 as never);

    teardown = installAtlasRecoveryListeners();
    teardown();
    teardown = null;

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    mq.fireChange();
    wake.fire();

    expect(t1.clearTextureAtlas).not.toHaveBeenCalled();
    expect(wake.subscriberCount()).toBe(0);
  });

  it('clears atlas on app:wake event', () => {
    const t1 = fakeTerm();
    const t2 = fakeTerm();
    terminalRegistry.set('s1', t1 as never);
    terminalRegistry.set('s2', t2 as never);

    teardown = installAtlasRecoveryListeners();
    wake.fire();

    expect(t1.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(t2.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it('app:wake recovery is not throttled (independent of focus throttle window)', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const t1 = fakeTerm();
    terminalRegistry.set('s1', t1 as never);

    teardown = installAtlasRecoveryListeners();

    // Burn the focus throttle window so any shared throttle would block subsequent wakes.
    window.dispatchEvent(new Event('focus'));
    expect(t1.clearTextureAtlas).toHaveBeenCalledTimes(1);

    vi.setSystemTime(now + 1_000);
    wake.fire();
    expect(t1.clearTextureAtlas).toHaveBeenCalledTimes(2);

    vi.setSystemTime(now + 2_000);
    wake.fire();
    expect(t1.clearTextureAtlas).toHaveBeenCalledTimes(3);
  });

  it('survives a terminal whose clearTextureAtlas throws', () => {
    const bad = { clearTextureAtlas: vi.fn(() => { throw new Error('disposed'); }) };
    const good = fakeTerm();
    terminalRegistry.set('bad', bad as never);
    terminalRegistry.set('good', good as never);

    teardown = installAtlasRecoveryListeners();
    document.dispatchEvent(new Event('visibilitychange'));

    expect(bad.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(good.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });
});
