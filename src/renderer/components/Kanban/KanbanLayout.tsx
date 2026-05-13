import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '../../stores/session-store';
import { useLayoutStore } from '../../stores/layout-store';
import { ErrorBoundary, ErrorFallback } from '../shared/ErrorBoundary';
import KanbanColumn from './KanbanColumn';
import KanbanExpandedContent from './KanbanExpandedContent';
import { KANBAN_COLUMNS, groupSessionsByColumn } from './kanban-utils';
import type { KanbanColumnId } from './kanban-utils';
import { formatShortTimeAt, useRelativeTimeTick } from '../../hooks/useRelativeTime';

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

function KanbanLayout(): React.JSX.Element {
  const boardRef = useRef<HTMLDivElement>(null);
  const sessions = useSessionStore(useShallow((s) => Object.values(s.sessions)));
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const kanbanExpandedSessionId = useLayoutStore((s) => s.kanbanExpandedSessionId);
  const kanbanOpenFiles = useLayoutStore((s) => s.kanbanOpenFiles);
  const expandKanbanSession = useLayoutStore((s) => s.expandKanbanSession);
  const clearKanbanExpand = useLayoutStore((s) => s.clearKanbanExpand);
  const relativeTimeTick = useRelativeTimeTick();

  const grouped = useMemo(() => groupSessionsByColumn(sessions), [sessions]);
  const groupedSessionIds = useMemo(
    () => Object.fromEntries(
      Object.entries(grouped).map(([columnId, columnSessions]) => [
        columnId,
        columnSessions.map((session) => session.sessionId),
      ]),
    ) as Record<KanbanColumnId, string[]>,
    [grouped],
  );
  const shortTimesBySessionId = useMemo(() => {
    void relativeTimeTick;
    const nowMs = Date.now();
    const result: Record<string, string> = {};
    for (const session of sessions) {
      result[session.sessionId] = formatShortTimeAt(session.startedAt, nowMs);
    }
    return result;
  }, [sessions, relativeTimeTick]);
  const expandedSession = useMemo(
    () => sessions.find((session) => session.sessionId === kanbanExpandedSessionId) ?? null,
    [kanbanExpandedSessionId, sessions],
  );

  // Auto-collapse if expanded session is deleted or ended
  useEffect(() => {
    if (!kanbanExpandedSessionId) return;
    if (!expandedSession || expandedSession.status === 'ended') {
      clearKanbanExpand();
    }
  }, [clearKanbanExpand, expandedSession, kanbanExpandedSessionId]);

  const handleSelectSession = useCallback((sessionId: string) => {
    useLayoutStore.getState().focusTile(`session:${sessionId}`);
    // Focus the board so it can receive Cmd+Enter keyboard events
    boardRef.current?.focus();
  }, []);

  const handleExpandSession = useCallback((sessionId: string) => {
    useLayoutStore.getState().focusTile(`session:${sessionId}`);
    expandKanbanSession(sessionId);
  }, [expandKanbanSession]);

  const handleKillSession = useCallback(async (sessionId: string) => {
    try {
      await window.mcode.sessions.kill(sessionId);
    } catch (err) {
      console.error('Failed to kill session:', err);
    }
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    const session = useSessionStore.getState().sessions[sessionId];
    if (!session) return;
    const confirmed = window.confirm(`Delete session "${session.label}"? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await window.mcode.sessions.delete(sessionId);
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }, []);

  const handleClearCompleted = useCallback(async () => {
    const confirmed = window.confirm('Delete all ended sessions? This cannot be undone.');
    if (!confirmed) return;
    try {
      await window.mcode.sessions.deleteAllEnded();
    } catch (err) {
      console.error('Failed to delete ended sessions:', err);
    }
  }, []);

  // Keyboard: Cmd+Enter to expand selected session from the board view
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key === 'Enter' && selectedSessionId && !kanbanExpandedSessionId) {
      e.preventDefault();
      handleExpandSession(selectedSessionId);
    }
  }, [selectedSessionId, kanbanExpandedSessionId, handleExpandSession]);

  // If a session is expanded or files are open, show the expanded content area
  const hasExpandedSession = kanbanExpandedSessionId && expandedSession;
  const hasOpenFiles = kanbanOpenFiles.length > 0;
  if (hasExpandedSession || hasOpenFiles) {
    return (
      <ErrorBoundary fallback={(props) => <ErrorFallback {...props} />}>
        <KanbanExpandedContent
          sessionId={hasExpandedSession ? kanbanExpandedSessionId : null}
        />
      </ErrorBoundary>
    );
  }

  // Kanban board view
  const isEmpty = sessions.length === 0;

  if (isEmpty) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        No sessions open. Click + in the sidebar to create one.
      </div>
    );
  }

  return (
    <div
      ref={boardRef}
      className="flex h-full w-full gap-3 p-3 overflow-x-auto outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {KANBAN_COLUMNS.map((column) => (
        <KanbanColumn
          key={column.id}
          column={column}
          sessionIds={groupedSessionIds[column.id]}
          shortTimesBySessionId={shortTimesBySessionId}
          selectedSessionId={selectedSessionId}
          onSelectSession={handleSelectSession}
          onExpandSession={handleExpandSession}
          onKillSession={handleKillSession}
          onDeleteSession={handleDeleteSession}
          onClearAll={column.id === 'completed' ? handleClearCompleted : undefined}
        />
      ))}
    </div>
  );
}

export default KanbanLayout;
