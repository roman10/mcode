// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  terminalRegistry,
  setTerminalFitAddon,
  forgetTerminalFitAddon,
  verifyAndCorrectFit,
  forceRefit,
} from '../../../../src/renderer/devtools/terminal-registry';

interface FakeFitTerm {
  cols: number;
  rows: number;
  element: HTMLElement | null;
}

function makeFitTerm(opts: { parentWidth: number; parentHeight: number; cols?: number; rows?: number }): FakeFitTerm {
  const parent = document.createElement('div');
  Object.defineProperty(parent, 'clientWidth', { value: opts.parentWidth, configurable: true });
  Object.defineProperty(parent, 'clientHeight', { value: opts.parentHeight, configurable: true });
  const el = document.createElement('div');
  parent.appendChild(el);
  return { cols: opts.cols ?? 80, rows: opts.rows ?? 24, element: el };
}

function makeFitAddon(proposed: { cols: number; rows: number } | undefined): {
  proposeDimensions: ReturnType<typeof vi.fn>;
  fit: ReturnType<typeof vi.fn>;
} {
  return { proposeDimensions: vi.fn(() => proposed), fit: vi.fn() };
}

describe('forceRefit', () => {
  beforeEach(() => {
    terminalRegistry.clear();
  });

  afterEach(() => {
    terminalRegistry.clear();
    forgetTerminalFitAddon('s1');
  });

  function fakeRefitTerm(): {
    clearTextureAtlas: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    rows: number;
  } {
    return { clearTextureAtlas: vi.fn(), refresh: vi.fn(), rows: 24 };
  }

  it('returns false when the session is unknown', () => {
    expect(forceRefit('nope')).toBe(false);
  });

  it('clears the terminal atlas directly, refits, and refreshes', () => {
    const term = fakeRefitTerm();
    const fit = makeFitAddon({ cols: 80, rows: 24 });
    terminalRegistry.set('s1', term as never);
    setTerminalFitAddon('s1', fit as never);

    expect(forceRefit('s1')).toBe(true);
    expect(term.clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(fit.fit).toHaveBeenCalledTimes(1);
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
  });

  it('swallows a clearTextureAtlas throw and still refits', () => {
    const term = {
      clearTextureAtlas: vi.fn(() => { throw new Error('disposed'); }),
      refresh: vi.fn(),
      rows: 24,
    };
    const fit = makeFitAddon({ cols: 80, rows: 24 });
    terminalRegistry.set('s1', term as never);
    setTerminalFitAddon('s1', fit as never);

    expect(() => forceRefit('s1')).not.toThrow();
    expect(forceRefit('s1')).toBe(true);
    expect(fit.fit).toHaveBeenCalled();
  });
});

describe('verifyAndCorrectFit', () => {
  beforeEach(() => {
    terminalRegistry.clear();
  });

  afterEach(() => {
    terminalRegistry.clear();
    forgetTerminalFitAddon('s1');
  });

  it('skips fit when parent has zero clientWidth (display:none ancestor)', () => {
    // FitAddon.proposeDimensions reads getComputedStyle(parent).width which
    // returns the literal "100%" for display:none ancestors → parseInt = 100 →
    // ~10 cols. Without the guard, this would shrink hidden terminals.
    const term = makeFitTerm({ parentWidth: 0, parentHeight: 0, cols: 80, rows: 24 });
    const fit = makeFitAddon({ cols: 10, rows: 5 });
    terminalRegistry.set('s1', term as never);
    setTerminalFitAddon('s1', fit as never);

    expect(verifyAndCorrectFit('s1')).toBe(false);
    expect(fit.proposeDimensions).not.toHaveBeenCalled();
    expect(fit.fit).not.toHaveBeenCalled();
  });

  it('skips fit when parent has zero clientHeight', () => {
    const term = makeFitTerm({ parentWidth: 800, parentHeight: 0, cols: 80, rows: 24 });
    const fit = makeFitAddon({ cols: 10, rows: 5 });
    terminalRegistry.set('s1', term as never);
    setTerminalFitAddon('s1', fit as never);

    expect(verifyAndCorrectFit('s1')).toBe(false);
    expect(fit.fit).not.toHaveBeenCalled();
  });

  it('skips fit when term.element has no parent', () => {
    const el = document.createElement('div');
    const term = { cols: 80, rows: 24, element: el };
    const fit = makeFitAddon({ cols: 10, rows: 5 });
    terminalRegistry.set('s1', term as never);
    setTerminalFitAddon('s1', fit as never);

    expect(verifyAndCorrectFit('s1')).toBe(false);
    expect(fit.fit).not.toHaveBeenCalled();
  });

  it('refits when proposed dimensions diverge from current cols/rows', () => {
    const term = makeFitTerm({ parentWidth: 800, parentHeight: 600, cols: 80, rows: 24 });
    const fit = makeFitAddon({ cols: 100, rows: 30 });
    terminalRegistry.set('s1', term as never);
    setTerminalFitAddon('s1', fit as never);

    expect(verifyAndCorrectFit('s1')).toBe(true);
    expect(fit.fit).toHaveBeenCalledTimes(1);
  });

  it('skips fit when proposed dimensions match within tolerance', () => {
    const term = makeFitTerm({ parentWidth: 800, parentHeight: 600, cols: 80, rows: 24 });
    const fit = makeFitAddon({ cols: 81, rows: 24 });
    terminalRegistry.set('s1', term as never);
    setTerminalFitAddon('s1', fit as never);

    expect(verifyAndCorrectFit('s1')).toBe(false);
    expect(fit.fit).not.toHaveBeenCalled();
  });
});
