import type { Terminal } from '@xterm/xterm';

/**
 * Global registry of active Terminal instances, keyed by session ID.
 * TerminalInstance registers on mount and unregisters on cleanup.
 * The devtools IPC bridge reads from this to serve buffer requests.
 */
export const terminalRegistry = new Map<string, Terminal>();

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
