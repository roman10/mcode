import { useEffect } from 'react';
import { clearAllAtlasesThrottled } from '../devtools/terminal-registry';
import { ATLAS_RECLEAR_THROTTLE_MS } from '@shared/constants';

/**
 * Installs the listeners that drive atlas recovery and returns a teardown.
 * Exported so it can be tested without a React render context.
 */
export function installAtlasRecoveryListeners(): () => void {
  // Window focus is the broad "user is back" signal — covers Cmd-tab back to
  // the app. Per-terminal click focus is handled in TerminalInstance and
  // shares the same `lastAtlasClearAt` timestamp via the registry helpers, so
  // a window-focus event right after a per-terminal focus no-ops.
  const onFocus = (): void => {
    clearAllAtlasesThrottled(ATLAS_RECLEAR_THROTTLE_MS);
  };

  // macOS lock/unlock with mcode in the foreground fires no focus or
  // visibilitychange event, so the recovery above wouldn't run after unlock.
  // Main forwards powerMonitor 'unlock-screen' / 'resume' as 'app:wake' for
  // exactly this case. Threshold 0: always clear, since wake is rare and
  // definitive (the atlas is almost certainly stale across sleep).
  const unsubWake = window.mcode?.app?.onWake?.(() => clearAllAtlasesThrottled(0));

  window.addEventListener('focus', onFocus);

  return () => {
    window.removeEventListener('focus', onFocus);
    unsubWake?.();
  };
}

/**
 * Recovers xterm.js WebGL texture atlases that get silently corrupted by events
 * Chromium does not surface as `WEBGL_lose_context` — notably macOS sleep/wake
 * (per xterm.js docs) and DPR changes when the window moves between displays
 * of different scale.
 *
 * Symptom without recovery: cells render fragments of other glyphs because the
 * GPU atlas has drifted from xterm's glyph map. The `WebglAddon.onContextLoss`
 * handler does NOT fire for these cases.
 *
 * Strategy: clear the atlas when the user turns attention to a terminal,
 * throttled per terminal via the registry's shared `lastAtlasClearAt` so
 * simultaneous renderer-wide and per-terminal triggers don't double-clear.
 *
 * - Per-terminal focus is handled by `TerminalInstance` directly so a click on
 *   a corrupted terminal recovers it.
 * - Renderer-wide signals live here: window `focus` covers Cmd-tab back to
 *   mcode; `app:wake` covers macOS lock/unlock without window focus loss.
 *
 * Mount once at the App level.
 */
export function useTerminalAtlasRecovery(): void {
  useEffect(() => installAtlasRecoveryListeners(), []);
}
