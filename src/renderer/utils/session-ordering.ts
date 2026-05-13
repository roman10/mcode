import type { SessionAttentionLevel, SessionInfo, SessionStatus } from '@shared/types';

const attentionOrder: Record<SessionAttentionLevel, number> = {
  action: 0,
  info:   1,
  none:   2,
};

const statusOrder: Record<SessionStatus, number> = {
  waiting: 0,
  active: 1,
  starting: 2,
  idle: 3,
  detached: 4,
  ended: 5,
};

/**
 * Canonical session ordering used by the sidebar and keyboard shortcuts.
 * Filters terminal sessions (they live in the bottom panel).
 * Sorts by attention → status → lastEventAt ?? startedAt (newest first).
 */
export function getOrderedVisibleSessions(sessions: Record<string, SessionInfo> | Iterable<SessionInfo>): SessionInfo[] {
  // Decorate-sort-undecorate: parse the timestamp once per session instead of
  // 2× per pairwise comparison. Hot path under coalesced session:updated bursts.
  const decorated: Array<{ s: SessionInfo; ts: number }> = [];
  const values = Symbol.iterator in Object(sessions)
    ? sessions as Iterable<SessionInfo>
    : Object.values(sessions);
  for (const s of values) {
    if (s.sessionType === 'terminal') continue;
    decorated.push({ s, ts: Date.parse(s.lastEventAt ?? s.startedAt) });
  }
  decorated.sort(
    (a, b) =>
      (attentionOrder[a.s.attentionLevel] ?? 9) - (attentionOrder[b.s.attentionLevel] ?? 9) ||
      (statusOrder[a.s.status] ?? 9) - (statusOrder[b.s.status] ?? 9) ||
      b.ts - a.ts,
  );
  return decorated.map((d) => d.s);
}

/**
 * Open (non-ended) sessions in canonical order.
 * Used by keyboard navigation (Cmd+]/[, Cmd+1..9) so focus cycling
 * skips sessions that have already terminated.
 */
export function getOrderedOpenSessions(sessions: Record<string, SessionInfo> | Iterable<SessionInfo>): SessionInfo[] {
  return getOrderedVisibleSessions(sessions).filter((s) => s.status !== 'ended');
}

/**
 * Filter sessions by a case-insensitive substring match on label or cwd.
 * Returns all sessions when query is empty.
 */
export function filterSessions(sessions: SessionInfo[], query: string): SessionInfo[] {
  if (!query) return sessions;
  const q = query.toLowerCase();
  return sessions.filter(
    (s) => s.label.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q),
  );
}
