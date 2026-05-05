import type { Terminal } from '@xterm/xterm';

/**
 * Global registry of active Terminal instances, keyed by session ID.
 * TerminalInstance registers on mount and unregisters on cleanup.
 * The devtools IPC bridge reads from this to serve buffer requests.
 */
export const terminalRegistry = new Map<string, Terminal>();

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
