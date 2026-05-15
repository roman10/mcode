import { useEffect } from 'react';
import { clearAllAtlasesThrottled } from '../devtools/terminal-registry';
import { requestRecreateAllWebgl } from '../utils/webgl-lifecycle';
import { ATLAS_RECLEAR_THROTTLE_MS, ATLAS_SWEEP_INTERVAL_MS } from '@shared/constants';

/** Coalesce back-to-back powerMonitor events (unlock-screen + resume often
 *  fire within ~50ms of each other). Recreating GL contexts twice in a tick
 *  hitches noticeably. */
const WAKE_DEBOUNCE_MS = 100;

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
  // exactly this case.
  //
  // Sleep/wake doesn't just stale the atlas — it can silently invalidate the
  // WebGL context itself (Chromium reports it as alive but the GPU resources
  // are dead, and onContextLoss does NOT fire). clearTextureAtlas() then
  // writes to a defunct texture and the terminal stays black. We dispatch a
  // recreate request first so each TerminalInstance disposes and reattaches
  // its WebglAddon; the atlas clear that follows is belt-and-suspenders for
  // any handle that's currently inactive (e.g. capped via MAX_WEBGL_CONTEXTS)
  // and won't get touched by the recreate path.
  let pendingWake = 0;
  const onWake = (): void => {
    if (document.hidden) return;  // visibility effect heals on next reveal
    if (pendingWake) window.clearTimeout(pendingWake);
    pendingWake = window.setTimeout(() => {
      pendingWake = 0;
      requestRecreateAllWebgl();
      const count = clearAllAtlasesThrottled(0);
      // One-liner naming the trigger: makes the otherwise-invisible recovery
      // observable (and assertable in tests — see wake-recovery.test.ts).
      console.log(
        `[atlas-recovery] wake — recreated WebGL + cleared atlas on ${count} terminal${count === 1 ? '' : 's'}`,
      );
    }, WAKE_DEBOUNCE_MS);
  };
  const unsubWake = window.mcode?.app?.onWake?.(onWake);

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
    if (pendingWake) window.clearTimeout(pendingWake);
    unsubWake?.();
  };
}

/**
 * Recovers xterm.js terminals from GPU-side state that Chromium does not
 * surface as `WEBGL_lose_context` — notably macOS sleep/wake (per xterm.js
 * docs), GPU process recycle, and other display-stack changes. Two distinct
 * failure modes are covered:
 *
 *   1. Texture-atlas drift — cells render fragments of other glyphs because
 *      the GPU atlas no longer matches xterm's glyph map. `clearTextureAtlas()`
 *      fixes this.
 *   2. Silently-dead WebGL context — `webgl.active` reports true but the
 *      underlying GPU resources are gone, so atlas clears write to nothing
 *      and the terminal renders fully black. Only disposing and recreating
 *      the WebglAddon recovers. `WebglAddon.onContextLoss` does NOT fire.
 *
 * Strategy: every signal that the user is interacting with mcode triggers a
 * fleet-wide atlas clear (per-terminal `lastAtlasClearAt` throttle prevents
 * redundancy). The wake signal additionally fans out a recreate request that
 * each TerminalInstance handles for itself. A periodic sweep covers the
 * silent-corruption events that fire no signal at all. Triggers in order of
 * decreasing specificity:
 *
 * - `app:wake` (powerMonitor unlock-screen / resume) — debounced 100ms; first
 *   recreates every visible terminal's WebGL context (sleep/wake can silently
 *   kill contexts without firing onContextLoss, so atlas-clear alone fails),
 *   then clears atlases as belt-and-suspenders for capped/inactive handles.
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
