import { useEffect } from 'react';
import { requestRecreateAllWebgl } from '../utils/webgl-lifecycle';

/** Coalesce back-to-back powerMonitor events (unlock-screen + resume often
 *  fire within ~50ms of each other). Recreating GL contexts twice in a tick
 *  hitches noticeably. */
const WAKE_DEBOUNCE_MS = 100;

/**
 * Installs the wake-time WebGL recovery listener and returns a teardown.
 * Exported so it can be tested without a React render context.
 */
export function installAtlasRecoveryListeners(): () => void {
  // macOS sleep/wake (and other display-stack events) can silently invalidate
  // the WebGL context — Chromium reports it as alive but the GPU resources are
  // dead, and `WebglAddon.onContextLoss` does NOT fire. The only thing that
  // recovers is disposing the WebglAddon and creating a fresh one. Lock/unlock
  // with mcode in the foreground fires no focus or visibilitychange event, so
  // main forwards powerMonitor 'unlock-screen' / 'resume' as 'app:wake'.
  //
  // Atlas drift (cells rendering fragments of other glyphs) is no longer a
  // concern: each terminal now has a private texture atlas
  // (atlasIsolatedFontFamily), so there is no cross-terminal staleness to
  // sweep for. Only the dead-context failure mode remains, handled here.
  let pendingWake = 0;
  const onWake = (): void => {
    if (document.hidden) return;  // visibility effect heals on next reveal
    if (pendingWake) window.clearTimeout(pendingWake);
    pendingWake = window.setTimeout(() => {
      pendingWake = 0;
      requestRecreateAllWebgl();
      // One-liner naming the trigger: makes the otherwise-invisible recovery
      // observable (and assertable in tests — see wake-recovery.test.ts).
      console.log('[atlas-recovery] wake — recreated WebGL contexts');
    }, WAKE_DEBOUNCE_MS);
  };
  const unsubWake = window.mcode?.app?.onWake?.(onWake);

  return () => {
    if (pendingWake) window.clearTimeout(pendingWake);
    unsubWake?.();
  };
}

/**
 * Recovers xterm.js terminals from the one GPU-side failure Chromium does not
 * surface as `WEBGL_lose_context`: macOS sleep/wake (per xterm.js docs), GPU
 * process recycle, and other display-stack changes can leave `webgl.active`
 * reporting true while the underlying GPU resources are gone, so the terminal
 * renders fully black. Only disposing and recreating the WebglAddon recovers.
 *
 * Texture-atlas drift (the other historical failure mode) is eliminated by
 * construction now that each terminal uses a private atlas
 * (`atlasIsolatedFontFamily`), so the previous focus / visibilitychange / 60s
 * sweep atlas-clear scaffolding is gone — there is no shared atlas to corrupt.
 *
 * Trigger: `app:wake` (powerMonitor unlock-screen / resume), debounced 100ms,
 * which fans out a recreate request each TerminalInstance handles for itself.
 *
 * Mount once at the App level.
 */
export function useTerminalAtlasRecovery(): void {
  useEffect(() => installAtlasRecoveryListeners(), []);
}
