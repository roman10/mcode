import { WebglAddon } from '@xterm/addon-webgl';
import type { Terminal } from '@xterm/xterm';

/**
 * Track active WebGL contexts across all terminal mounts.
 * Browsers typically allow 8–16 contexts before evicting the oldest.
 */
let activeWebglContexts = 0;
const MAX_WEBGL_CONTEXTS = 6;

export function getActiveWebglContextCount(): number {
  return activeWebglContexts;
}

export function resetActiveWebglContextCount(): void {
  activeWebglContexts = 0;
}

export interface WebglHandle {
  /** Dispose the WebGL addon and decrement the context counter. Idempotent. */
  detach(): void;
  /** Whether a WebGL addon is currently active. */
  readonly active: boolean;
  /** Try to re-attach WebGL if it was previously detached. */
  reattach(): boolean;
}

type RecreateListener = () => void;
const recreateListeners = new Set<RecreateListener>();

/**
 * Subscribe to "please dispose+reattach your WebGL handle" requests.
 * Used by TerminalInstance to react to wake-time recovery — sleep/wake can
 * silently invalidate WebGL contexts without firing onContextLoss, and the
 * only thing that recovers is a fresh WebglAddon. Each subscriber decides
 * whether/how to react based on its own visibility / handle state.
 *
 * Returns an unsubscribe function. Listeners are invoked synchronously and
 * isolated via try/catch so one throw can't suppress siblings.
 */
export function onWebglRecreateRequested(listener: RecreateListener): () => void {
  recreateListeners.add(listener);
  return () => { recreateListeners.delete(listener); };
}

/**
 * Fan out a recreate request to every subscriber. Called from the wake
 * recovery path in useTerminalAtlasRecovery.
 */
export function requestRecreateAllWebgl(): void {
  recreateListeners.forEach((l) => {
    try {
      l();
    } catch (e) {
      console.warn('[WebGL] recreate listener threw:', e);
    }
  });
}

/** Test hook: drop every registered listener so tests start from a clean slate. */
export function clearWebglRecreateListenersForTesting(): void {
  recreateListeners.clear();
}

/**
 * Attach a WebglAddon to an xterm Terminal with context-loss handling
 * and a cap on total active WebGL contexts.
 */
export function attachWebgl(term: Terminal, sessionId: string): WebglHandle {
  let webglAddon: WebglAddon | null = null;
  let contextLossSub: { dispose(): void } | null = null;

  function detach(): void {
    if (contextLossSub) {
      contextLossSub.dispose();
      contextLossSub = null;
    }
    if (webglAddon) {
      try {
        webglAddon.dispose();
      } catch {
        // Addon may already be partially disposed after context loss
      }
      webglAddon = null;
      activeWebglContexts--;
    }
  }

  function attach(): boolean {
    if (activeWebglContexts >= MAX_WEBGL_CONTEXTS) {
      return false;
    }
    try {
      const addon = new WebglAddon();
      term.loadAddon(addon);
      contextLossSub = addon.onContextLoss(() => {
        console.warn(
          `[WebGL] Context lost for session ${sessionId}, falling back to DOM renderer`,
        );
        detach();
      });
      webglAddon = addon;
      activeWebglContexts++;
      return true;
    } catch (e) {
      console.warn('WebGL addon failed, falling back to DOM renderer:', e);
      return false;
    }
  }

  attach();

  return {
    detach,
    get active() {
      return webglAddon !== null;
    },
    reattach(): boolean {
      if (webglAddon) return true;
      return attach();
    },
  };
}
