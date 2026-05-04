import { useEffect } from 'react';
import { terminalRegistry } from '../devtools/terminal-registry';

const FOCUS_THROTTLE_MS = 30_000;

function clearAllAtlases(reason: string): void {
  let count = 0;
  terminalRegistry.forEach((term) => {
    try {
      term.clearTextureAtlas();
      count++;
    } catch {
      // Terminal may have been disposed mid-iteration
    }
  });
  if (count > 0) {
    console.log(`[atlas-recovery] ${reason} — cleared atlas on ${count} terminal${count === 1 ? '' : 's'}`);
  }
}

/**
 * Installs the listeners that drive atlas recovery and returns a teardown.
 * Exported so it can be tested without a React render context.
 */
export function installAtlasRecoveryListeners(): () => void {
  let lastFocusRecoveryAt = 0;

  const onVisibilityChange = (): void => {
    if (!document.hidden) clearAllAtlases('visibilitychange');
  };

  const onFocus = (): void => {
    const now = Date.now();
    if (now - lastFocusRecoveryAt < FOCUS_THROTTLE_MS) return;
    lastFocusRecoveryAt = now;
    clearAllAtlases('focus');
  };

  let mql: MediaQueryList | null = null;
  let onDprChange: ((e: MediaQueryListEvent) => void) | null = null;
  function bindDprListener(): void {
    mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    onDprChange = (): void => {
      clearAllAtlases('dpr-change');
      // matchMedia query is now stale — re-bind with the new DPR.
      if (mql && onDprChange) mql.removeEventListener('change', onDprChange);
      bindDprListener();
    };
    mql.addEventListener('change', onDprChange);
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onFocus);
  bindDprListener();

  // macOS screen lock with mcode in foreground fires neither visibilitychange
  // nor focus, so the recovery above never runs after unlock. Main forwards
  // powerMonitor 'unlock-screen' / 'resume' as 'app:wake' for that path.
  // No throttle: wake is rare and definitive.
  const unsubWake = window.mcode?.app?.onWake?.(() => clearAllAtlases('wake'));

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onFocus);
    if (mql && onDprChange) mql.removeEventListener('change', onDprChange);
    unsubWake?.();
  };
}

/**
 * Recovers xterm.js WebGL texture atlases that get silently corrupted by events
 * Chromium does not surface as `WEBGL_lose_context` — notably macOS sleep/wake
 * (per xterm.js docs) and DPR changes when dragging the window between displays
 * of different scale.
 *
 * Symptom without this: terminals render mostly black except for the cursor and
 * any glyphs written after the corruption (newly cached on the fly). The
 * `WebglAddon.onContextLoss` handler does NOT fire for these cases.
 *
 * Mount once at the App level. Iterates `terminalRegistry` on each trigger and
 * calls `Terminal.clearTextureAtlas()`, which is a no-op when the DOM renderer
 * is active.
 */
export function useTerminalAtlasRecovery(): void {
  useEffect(() => installAtlasRecoveryListeners(), []);
}
