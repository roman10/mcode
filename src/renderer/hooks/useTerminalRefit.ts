import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import { verifyAndCorrectFit } from '../devtools/terminal-registry';

/**
 * Owns the multi-pass refit machinery for a terminal tile.
 *
 * `safeFit()` is the gated single-pass fit — it skips when the tile is
 * hidden or the container hasn't laid out (zero dimensions), because
 * fitting to 0×0 would resize xterm to the tiny grid, hand bash a SIGWINCH,
 * and have the resulting prompt-redraw bytes garble the screen during the
 * later catch-up replay at the restored full size.
 *
 * `scheduleRefit()` debounces three passes against shared refs:
 *
 *   - `setTimeout(0)` catches the common post-layout case.
 *   - `requestAnimationFrame` covers the next paint cycle.
 *   - `setTimeout(100)` is the backstop for when the immediate fit lands on
 *     transient dimensions (the b1773fd failure mode).
 *
 * Each pass also calls `verifyAndCorrectFit(sessionId)` so the broker's
 * cached rows/cols stay in sync. Overlapping `scheduleRefit()` calls
 * collapse — every pass clears its predecessor first.
 */
export function useTerminalRefit(opts: {
  termRef: RefObject<HTMLDivElement | null>;
  fitAddonRef: RefObject<FitAddon | null>;
  isVisibleRef: RefObject<boolean>;
  sessionId: string;
}): {
  safeFit: () => void;
  scheduleRefit: () => void;
} {
  const { termRef, fitAddonRef, isVisibleRef, sessionId } = opts;

  const safeFit = useCallback((): void => {
    if (!isVisibleRef.current) return;
    const c = termRef.current;
    if (!c || c.clientWidth === 0 || c.clientHeight === 0) return;
    fitAddonRef.current?.fit();
  }, [termRef, fitAddonRef, isVisibleRef]);

  const pendingFitT0Ref = useRef(0);
  const pendingFitRafRef = useRef(0);
  const pendingFitT100Ref = useRef(0);

  const scheduleRefit = useCallback((): void => {
    if (pendingFitT0Ref.current) clearTimeout(pendingFitT0Ref.current);
    if (pendingFitRafRef.current) cancelAnimationFrame(pendingFitRafRef.current);
    if (pendingFitT100Ref.current) clearTimeout(pendingFitT100Ref.current);
    pendingFitT0Ref.current = window.setTimeout(() => {
      pendingFitT0Ref.current = 0;
      safeFit();
    }, 0);
    pendingFitRafRef.current = requestAnimationFrame(() => {
      pendingFitRafRef.current = 0;
      safeFit();
      verifyAndCorrectFit(sessionId);
    });
    pendingFitT100Ref.current = window.setTimeout(() => {
      pendingFitT100Ref.current = 0;
      verifyAndCorrectFit(sessionId);
    }, 100);
  }, [safeFit, sessionId]);

  useEffect(() => () => {
    if (pendingFitT0Ref.current) clearTimeout(pendingFitT0Ref.current);
    if (pendingFitRafRef.current) cancelAnimationFrame(pendingFitRafRef.current);
    if (pendingFitT100Ref.current) clearTimeout(pendingFitT100Ref.current);
  }, []);

  return { safeFit, scheduleRefit };
}
