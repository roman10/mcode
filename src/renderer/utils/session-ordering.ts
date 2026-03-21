import type { SessionAttentionLevel, SessionInfo, SessionStatus } from '../../shared/types';

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
 * Filters ephemeral sessions, sorts by attention → status → startedAt (newest first).
 */
export function getOrderedVisibleSessions(sessions: Record<string, SessionInfo>): SessionInfo[] {
  return Object.values(sessions)
    .filter((s) => !s.ephemeral)
    .sort(
      (a, b) =>
        (attentionOrder[a.attentionLevel] ?? 9) - (attentionOrder[b.attentionLevel] ?? 9) ||
        (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) ||
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
}
