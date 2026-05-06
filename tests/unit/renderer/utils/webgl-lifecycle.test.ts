import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock WebglAddon ---

let capturedContextLossCallback: (() => void) | null = null;
const mockDispose = vi.fn();
const mockOnContextLoss = vi.fn().mockImplementation((cb: () => void) => {
  capturedContextLossCallback = cb;
  return { dispose: vi.fn() };
});

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class MockWebglAddon {
    onContextLoss = mockOnContextLoss;
    dispose = mockDispose;
  },
}));

const mockLoadAddon = vi.fn();
function makeMockTerminal() {
  return { loadAddon: mockLoadAddon } as any;
}

const {
  attachWebgl,
  getActiveWebglContextCount,
  resetActiveWebglContextCount,
  onWebglRecreateRequested,
  requestRecreateAllWebgl,
  clearWebglRecreateListenersForTesting,
} = await import('../../../../src/renderer/utils/webgl-lifecycle');

describe('webgl-lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedContextLossCallback = null;
    resetActiveWebglContextCount();
    clearWebglRecreateListenersForTesting();
  });

  // ----------------------------------------------------------------
  // Bug reproduction: context loss must be handled
  // ----------------------------------------------------------------

  it('registers an onContextLoss handler on the WebGL addon', () => {
    const term = makeMockTerminal();
    attachWebgl(term, 'sess-1');

    // The addon's onContextLoss must be subscribed to.
    // Without this, a lost WebGL context silently breaks rendering.
    expect(mockOnContextLoss).toHaveBeenCalledTimes(1);
    expect(mockOnContextLoss).toHaveBeenCalledWith(expect.any(Function));
  });

  it('disposes WebGL addon and decrements counter when context is lost', () => {
    const term = makeMockTerminal();
    const handle = attachWebgl(term, 'sess-1');

    expect(handle.active).toBe(true);
    expect(getActiveWebglContextCount()).toBe(1);

    // Simulate browser evicting the WebGL context
    expect(capturedContextLossCallback).not.toBeNull();
    capturedContextLossCallback!();

    expect(mockDispose).toHaveBeenCalled();
    expect(handle.active).toBe(false);
    expect(getActiveWebglContextCount()).toBe(0);
  });

  it('terminal remains functional after context loss (falls back to DOM renderer)', () => {
    const term = makeMockTerminal();
    const handle = attachWebgl(term, 'sess-1');

    // Simulate context loss
    capturedContextLossCallback!();

    // detach should be idempotent — calling it again must not underflow the counter
    handle.detach();
    expect(getActiveWebglContextCount()).toBe(0);
  });

  // ----------------------------------------------------------------
  // Context cap prevents exhaustion
  // ----------------------------------------------------------------

  it('skips WebGL when context cap is reached', () => {
    const handles = [];
    for (let i = 0; i < 6; i++) {
      handles.push(attachWebgl(makeMockTerminal(), `sess-${i}`));
    }
    expect(getActiveWebglContextCount()).toBe(6);

    // 7th terminal should skip WebGL
    const overflow = attachWebgl(makeMockTerminal(), 'sess-overflow');
    expect(overflow.active).toBe(false);
    expect(getActiveWebglContextCount()).toBe(6);
  });

  it('allows new WebGL after a context is freed', () => {
    const handles = [];
    for (let i = 0; i < 6; i++) {
      handles.push(attachWebgl(makeMockTerminal(), `sess-${i}`));
    }

    // Free one slot
    handles[0].detach();
    expect(getActiveWebglContextCount()).toBe(5);

    // New terminal should get WebGL now
    const fresh = attachWebgl(makeMockTerminal(), 'sess-fresh');
    expect(fresh.active).toBe(true);
    expect(getActiveWebglContextCount()).toBe(6);
  });

  // ----------------------------------------------------------------
  // Reattach after context loss
  // ----------------------------------------------------------------

  it('can reattach WebGL after context loss', () => {
    const term = makeMockTerminal();
    const handle = attachWebgl(term, 'sess-1');

    capturedContextLossCallback!();
    expect(handle.active).toBe(false);

    const ok = handle.reattach();
    expect(ok).toBe(true);
    expect(handle.active).toBe(true);
    expect(getActiveWebglContextCount()).toBe(1);
  });

  // ----------------------------------------------------------------
  // Cleanup
  // ----------------------------------------------------------------

  it('detach is idempotent', () => {
    const term = makeMockTerminal();
    const handle = attachWebgl(term, 'sess-1');
    handle.detach();
    handle.detach(); // second call should be safe
    expect(getActiveWebglContextCount()).toBe(0);
  });

  it('increments and decrements context counter correctly across multiple terminals', () => {
    const h1 = attachWebgl(makeMockTerminal(), 'a');
    const h2 = attachWebgl(makeMockTerminal(), 'b');
    const h3 = attachWebgl(makeMockTerminal(), 'c');
    expect(getActiveWebglContextCount()).toBe(3);

    h2.detach();
    expect(getActiveWebglContextCount()).toBe(2);

    h1.detach();
    h3.detach();
    expect(getActiveWebglContextCount()).toBe(0);
  });

  // ----------------------------------------------------------------
  // Recreate request pub/sub — drives wake-time WebGL recovery.
  // Sleep/wake can silently invalidate GL contexts; subscribers
  // (TerminalInstance) react by disposing and reattaching their WebglAddon.
  // ----------------------------------------------------------------

  it('invokes every registered listener on requestRecreateAllWebgl', () => {
    const a = vi.fn();
    const b = vi.fn();
    onWebglRecreateRequested(a);
    onWebglRecreateRequested(b);

    requestRecreateAllWebgl();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('returns a teardown that unsubscribes the listener', () => {
    const listener = vi.fn();
    const unsub = onWebglRecreateRequested(listener);

    requestRecreateAllWebgl();
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    requestRecreateAllWebgl();
    expect(listener).toHaveBeenCalledTimes(1);  // not called again
  });

  it('isolates a throwing listener from siblings', () => {
    const before = vi.fn();
    const thrower = vi.fn(() => { throw new Error('boom'); });
    const after = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    onWebglRecreateRequested(before);
    onWebglRecreateRequested(thrower);
    onWebglRecreateRequested(after);

    expect(() => requestRecreateAllWebgl()).not.toThrow();
    expect(before).toHaveBeenCalledTimes(1);
    expect(thrower).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('detach + reattach in sequence (the wake recovery shape) yields a fresh addon load', () => {
    const term = makeMockTerminal();
    const handle = attachWebgl(term, 'sess-wake');
    expect(mockLoadAddon).toHaveBeenCalledTimes(1);
    expect(handle.active).toBe(true);

    // Simulate the wake recreate path: detach, then reattach.
    handle.detach();
    handle.reattach();

    expect(mockDispose).toHaveBeenCalledTimes(1);
    expect(mockLoadAddon).toHaveBeenCalledTimes(2);  // fresh addon loaded
    expect(handle.active).toBe(true);
    expect(getActiveWebglContextCount()).toBe(1);
  });

  it('recreating six active handles in tight loop never exceeds the cap', () => {
    const handles = [];
    for (let i = 0; i < 6; i++) {
      handles.push(attachWebgl(makeMockTerminal(), `sess-${i}`));
    }
    expect(getActiveWebglContextCount()).toBe(6);

    // Mimic requestRecreateAllWebgl fan-out with each TerminalInstance's
    // detach+reattach: counter drops to 5 then back to 6 each iteration.
    for (const h of handles) {
      h.detach();
      h.reattach();
    }

    expect(getActiveWebglContextCount()).toBe(6);
    expect(handles.every((h) => h.active)).toBe(true);
  });
});
