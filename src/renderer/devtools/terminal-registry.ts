import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

/**
 * Global registry of active Terminal instances, keyed by session ID.
 * TerminalInstance registers on mount and unregisters on cleanup.
 * The devtools IPC bridge reads from this to serve buffer requests.
 */
export const terminalRegistry = new Map<string, Terminal>();

/**
 * Per-session FitAddon, registered alongside the Terminal so the
 * verify-and-correct path (post-maximize) and the manual force-refit recovery
 * can call `proposeDimensions()` / `fit()` without reaching into xterm internals.
 */
const fitAddonRegistry = new Map<string, FitAddon>();

export function setTerminalFitAddon(sessionId: string, fitAddon: FitAddon): void {
  fitAddonRegistry.set(sessionId, fitAddon);
}

export function forgetTerminalFitAddon(sessionId: string): void {
  fitAddonRegistry.delete(sessionId);
}

/**
 * Sessions whose xterm is currently receiving live `pty.onData` writes.
 *
 * Hidden tabs and tabs mid-replay drop live writes (per TerminalInstance), so
 * their xterm scrollback is intentionally stale. Devtools' `readTerminalBuffer`
 * checks this set: when a session is not live, it returns empty and the main
 * process falls back to the broker's authoritative ring buffer — keeping the
 * MCP integration tools working regardless of UI visibility.
 */
const liveTerminals = new Set<string>();

export function setTerminalLive(sessionId: string, isLive: boolean): void {
  if (isLive) liveTerminals.add(sessionId);
  else liveTerminals.delete(sessionId);
}

export function isTerminalLive(sessionId: string): boolean {
  return liveTerminals.has(sessionId);
}

/**
 * Devtools hook: trigger the same dispose path the HIDDEN_TILE_DISPOSE_MS
 * timer would, so integration tests can exercise dispose-then-replay without
 * waiting 5 minutes. TerminalInstance registers a callback per sessionId that
 * sets `shouldMount` to false; the callback runs only if the tile is hidden.
 */
const disposeHiddenTileHandlers = new Map<string, () => boolean>();

export function registerDisposeHiddenTile(
  sessionId: string,
  handler: () => boolean,
): () => void {
  disposeHiddenTileHandlers.set(sessionId, handler);
  return () => {
    if (disposeHiddenTileHandlers.get(sessionId) === handler) {
      disposeHiddenTileHandlers.delete(sessionId);
    }
  };
}

export function forceDisposeHiddenTile(sessionId: string): boolean {
  return disposeHiddenTileHandlers.get(sessionId)?.() ?? false;
}

/**
 * Detect-and-correct narrow-rendering after a layout transition.
 *
 * Background: when a tile is maximized, the overlay div flips from display:none
 * to block, the body is portaled in, and `setTimeout(0)` schedules `safeFit()`.
 * That callback can fire before the browser's layout pass has settled the new
 * overlay size, so `container.clientWidth` reads a transient narrow value, fit
 * computes narrow cols, and the terminal locks there with no corrective second
 * pass. This helper runs at rAF / 100ms after the transition: by then the
 * overlay has its true bounds, so `proposeDimensions()` returns the correct
 * cols/rows. If it disagrees with the live `term.cols/rows` by more than 1,
 * we re-fit. Idempotent — safe to call repeatedly.
 *
 * Visibility guard: FitAddon.proposeDimensions() reads
 * `getComputedStyle(parent).width`, which returns the *specified* value ("100%")
 * for display:none ancestors instead of a resolved pixel value. parseInt("100%")
 * = 100, so without the guard we'd compute ~10 cols on every hidden tile (e.g.
 * the non-maximized tiles whose wrappers go display:none under an overlay) and
 * shrink them to a narrow grid that survives until the next visible refit.
 * `parent.clientWidth` IS resolved (returns 0 under display:none), so we mirror
 * the same gate `safeFit` uses at TerminalInstance.tsx and skip hidden tiles
 * entirely. They re-fit naturally when revealed via ResizeObserver.
 *
 * Returns whether a corrective fit ran.
 */
export function verifyAndCorrectFit(sessionId: string): boolean {
  const term = terminalRegistry.get(sessionId);
  const fitAddon = fitAddonRegistry.get(sessionId);
  if (!term || !fitAddon) return false;
  const parent = term.element?.parentElement;
  if (!parent || parent.clientWidth === 0 || parent.clientHeight === 0) return false;
  let proposed: { cols: number; rows: number } | undefined;
  try {
    proposed = fitAddon.proposeDimensions();
  } catch {
    return false;
  }
  if (!proposed) return false;
  const colsDelta = Math.abs(proposed.cols - term.cols);
  const rowsDelta = Math.abs(proposed.rows - term.rows);
  if (colsDelta <= 1 && rowsDelta <= 1) return false;
  try {
    fitAddon.fit();
  } catch {
    return false;
  }
  return true;
}

/**
 * Manual recovery: clear the WebGL atlas, re-fit unconditionally (bypassing
 * the visibility gate `safeFit` enforces), and force a redraw of the visible
 * rows. Used by the toolbar's "Refit terminal" button and the matching MCP
 * action so users / tests can recover from a wedged narrow-render that
 * survived the auto-fix passes.
 *
 * Atlas clear only — no `requestRecreateAllWebgl()`. Narrow-render is a
 * sizing bug, not a context-loss bug; keep the manual path cheap.
 *
 * Returns whether the refit ran (false if the session is unknown).
 */
export function forceRefit(sessionId: string): boolean {
  const term = terminalRegistry.get(sessionId);
  const fitAddon = fitAddonRegistry.get(sessionId);
  if (!term || !fitAddon) return false;
  try {
    term.clearTextureAtlas();
  } catch {
    // Terminal may have been disposed mid-call; the fit below is the
    // load-bearing recovery, so swallow and continue.
  }
  try {
    fitAddon.fit();
  } catch {
    return false;
  }
  try {
    if (term.rows > 0) term.refresh(0, term.rows - 1);
  } catch {
    // refresh can throw on a disposed terminal; the fit above is the load-bearing call.
  }
  return true;
}
