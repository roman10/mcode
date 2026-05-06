import { useEffect } from 'react';
import { clearAllAtlasesThrottled } from '../devtools/terminal-registry';
import { ATLAS_RECLEAR_THROTTLE_MS, ATLAS_SWEEP_INTERVAL_MS } from '@shared/constants';

/**
 * Installs the listeners that drive atlas recovery and returns a teardown.
 * Exported so it can be tested without a React render context.
 */
export function installAtlasRecoveryListeners(): () => void {
  // Window focus — broad "user is back" signal, covers Cmd-tab back to the app.
  // Per-terminal click focus is handled in TerminalInstance and shares the same
  // `lastAtlasClearAt` timestamp via the registry helpers, so a window-focus
  // event right after a per-terminal focus no-ops.
  const onFocus = (): void => {
    clearAllAtlasesThrottled(ATLAS_RECLEAR_THROTTLE_MS);
  };

  // Document visibility — fires on Cmd-H show/hide, window minimize/restore,
  // and other transitions where window `focus` may not fire (e.g., the app
  // was hidden via app menu rather than being de-focused). Cheap to listen
  // for and pairs naturally with how macOS users move between apps.
  const onVisibilityChange = (): void => {
    if (!document.hidden) clearAllAtlasesThrottled(ATLAS_RECLEAR_THROTTLE_MS);
  };

  // macOS lock/unlock with mcode in the foreground fires no focus or
  // visibilitychange event, so the recovery above wouldn't run after unlock.
  // Main forwards powerMonitor 'unlock-screen' / 'resume' as 'app:wake' for
  // exactly this case. Threshold 0: always clear, since wake is rare and
  // definitive (the atlas is almost certainly stale across sleep).
  const unsubWake = window.mcode?.app?.onWake?.(() => clearAllAtlasesThrottled(0));

  // Belt-and-suspenders: corruption from GPU process recycle, refresh-rate or
  // color-profile change, and other Chromium-internal events fires no signal
  // we can react to. While the window has focus, sweep all atlases at the
  // sweep interval. Threshold = interval so terminals just cleared by a focus
  // event skip the sweep — every terminal is cleared at least once per
  // interval, never more often than necessary.
  const sweepInterval = window.setInterval(() => {
    if (document.hasFocus()) clearAllAtlasesThrottled(ATLAS_SWEEP_INTERVAL_MS);
  }, ATLAS_SWEEP_INTERVAL_MS);

  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.clearInterval(sweepInterval);
    unsubWake?.();
  };
}

/**
 * Recovers xterm.js WebGL texture atlases that get silently corrupted by events
 * Chromium does not surface as `WEBGL_lose_context` — notably macOS sleep/wake
 * (per xterm.js docs), GPU process recycle, and other display-stack changes.
 *
 * Symptom without recovery: cells render fragments of other glyphs because the
 * GPU atlas has drifted from xterm's glyph map. The `WebglAddon.onContextLoss`
 * handler does NOT fire for these cases.
 *
 * Strategy: every signal that the user is interacting with mcode triggers a
 * fleet-wide clear (per-terminal `lastAtlasClearAt` throttle prevents
 * redundancy). A periodic sweep covers silent-corruption events that fire no
 * signal at all. The four triggers, in order of decreasing specificity:
 *
 * - `app:wake` (powerMonitor unlock-screen / resume) — definitive, no throttle.
 * - Per-terminal container `focus` — fires fleet-wide so a click on any visible
 *   tile recovers all of them; not just the clicked one.
 * - Window `focus` and `document.visibilitychange` — Cmd-tab and Cmd-H.
 * - 60s periodic sweep gated on `document.hasFocus()` — final safety net.
 *
 * Mount once at the App level.
 */
export function useTerminalAtlasRecovery(): void {
  useEffect(() => installAtlasRecoveryListeners(), []);
}
