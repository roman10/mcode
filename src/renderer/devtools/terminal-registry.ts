import type { Terminal } from '@xterm/xterm';

/**
 * Global registry of active Terminal instances, keyed by session ID.
 * TerminalInstance registers on mount and unregisters on cleanup.
 * The devtools IPC bridge reads from this to serve buffer requests.
 */
export const terminalRegistry = new Map<string, Terminal>();

/**
 * Per-terminal timestamp of the last `clearTextureAtlas()` call. Shared across
 * every clear path so a just-cleared atlas isn't cleared again by another
 * trigger firing milliseconds later. Pruned by `forgetAtlasClear` on teardown.
 */
const lastAtlasClearAt = new Map<string, number>();

/**
 * Clear a single terminal's WebGL texture atlas if it has been at least
 * `thresholdMs` since the last clear (or unconditionally when threshold is 0).
 * Returns whether a clear actually ran. Safe on disposed/unknown sessions
 * (returns false and prunes any stale timestamp).
 */
export function clearAtlasThrottled(
  sessionId: string,
  thresholdMs: number,
): boolean {
  const term = terminalRegistry.get(sessionId);
  if (!term) {
    lastAtlasClearAt.delete(sessionId);
    return false;
  }
  const now = Date.now();
  const last = lastAtlasClearAt.get(sessionId) ?? 0;
  // `elapsed >= 0` guard: if the wall clock moved backwards (NTP correction,
  // hibernation, test timer manipulation), don't honor the prior timestamp —
  // treat as fresh and clear. Throttle exists to prevent redundant rapid
  // clears, not to suppress recovery after time discontinuities.
  const elapsed = now - last;
  if (thresholdMs > 0 && elapsed >= 0 && elapsed < thresholdMs) return false;
  try {
    term.clearTextureAtlas();
  } catch {
    // Terminal may have been disposed mid-call — drop the timestamp and bail.
    lastAtlasClearAt.delete(sessionId);
    return false;
  }
  lastAtlasClearAt.set(sessionId, now);
  return true;
}

/**
 * Throttled clear across every registered terminal. Returns the count cleared.
 * Each terminal's throttle is independent (shared timestamp per terminal).
 */
export function clearAllAtlasesThrottled(thresholdMs: number): number {
  let count = 0;
  terminalRegistry.forEach((_term, sessionId) => {
    if (clearAtlasThrottled(sessionId, thresholdMs)) count++;
  });
  return count;
}

/**
 * Drop the atlas-clear timestamp for a session. Call from TerminalInstance
 * cleanup to keep `lastAtlasClearAt` from accumulating dead session IDs.
 */
export function forgetAtlasClear(sessionId: string): void {
  lastAtlasClearAt.delete(sessionId);
}

/**
 * Drop every recorded atlas-clear timestamp. Used in tests to isolate state
 * across cases, since the registry is a module singleton.
 */
export function forgetAllAtlasClears(): void {
  lastAtlasClearAt.clear();
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
