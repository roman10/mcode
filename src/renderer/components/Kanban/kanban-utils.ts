import type { SessionInfo } from '@shared/types';

export type KanbanColumnId = 'needs-attention' | 'working' | 'ready' | 'completed';

export interface KanbanColumnDef {
  id: KanbanColumnId;
  label: string;
  emptyMessage: string;
  accentColor: string; // Tailwind border color class
}

export const KANBAN_COLUMNS: KanbanColumnDef[] = [
  {
    id: 'needs-attention',
    label: 'Needs Attention',
    emptyMessage: 'No sessions need attention',
    accentColor: 'border-t-red-400',
  },
  {
    id: 'working',
    label: 'Working',
    emptyMessage: 'No active sessions',
    accentColor: 'border-t-blue-400',
  },
  {
    id: 'ready',
    label: 'Ready',
    emptyMessage: 'No idle sessions',
    accentColor: 'border-t-green-400',
  },
  {
    id: 'completed',
    label: 'Completed',
    emptyMessage: 'No ended sessions',
    accentColor: 'border-t-neutral-500',
  },
];

/**
 * Derive which kanban column a session belongs to.
 * Attention level takes precedence over status.
 */
export function getKanbanColumn(session: SessionInfo): KanbanColumnId {
  // Action attention or waiting → needs attention (info is informational, no action required)
  if (session.attentionLevel === 'action' || session.status === 'waiting') {
    return 'needs-attention';
  }

  // Ended → completed
  if (session.status === 'ended') {
    return 'completed';
  }

  // Starting or active → working
  if (session.status === 'starting' || session.status === 'active') {
    return 'working';
  }

  // Idle → ready
  return 'ready';
}

const attentionOrder: Record<string, number> = {
  action: 0,
  info:   1,
  none:   2,
};

/**
 * Sort sessions within a column: attention level desc → startedAt desc (newest first).
 */
export function sortColumnSessions(sessions: SessionInfo[]): SessionInfo[] {
  return [...sessions].sort((a, b) => {
    const attnA = attentionOrder[a.attentionLevel] ?? 3;
    const attnB = attentionOrder[b.attentionLevel] ?? 3;
    if (attnA !== attnB) return attnA - attnB;
    return b.startedAt.localeCompare(a.startedAt);
  });
}

/**
 * Group sessions by kanban column.
 */
export function groupSessionsByColumn(
  sessions: Record<string, SessionInfo>,
): Record<KanbanColumnId, SessionInfo[]> {
  const groups: Record<KanbanColumnId, SessionInfo[]> = {
    'needs-attention': [],
    'working': [],
    'ready': [],
    'completed': [],
  };

  for (const session of Object.values(sessions)) {
    const column = getKanbanColumn(session);
    groups[column].push(session);
  }

  // Sort within each column
  for (const key of Object.keys(groups) as KanbanColumnId[]) {
    groups[key] = sortColumnSessions(groups[key]);
  }

  return groups;
}
