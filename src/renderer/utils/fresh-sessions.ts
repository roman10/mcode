// Session IDs whose first TerminalInstance mount can skip the initial
// pty:replay-since(0) round-trip. Marked by handleCreateSession (the spawn
// is brand-new, so the broker ring buffer is empty); consumed by the
// TerminalInstance setup effect on the *first* mount only — a later
// hide → dispose → reveal remount goes through the normal replay path.

const fresh = new Set<string>();

export function markFresh(sessionId: string): void {
  fresh.add(sessionId);
}

export function consumeFresh(sessionId: string): boolean {
  return fresh.delete(sessionId);
}
