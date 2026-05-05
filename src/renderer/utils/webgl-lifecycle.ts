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
