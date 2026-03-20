import { useCallback, useEffect, useRef } from 'react';
import { useSessionStore } from '../../stores/session-store';
import { useLayoutStore } from '../../stores/layout-store';
import TerminalTile from '../Terminal/TerminalTile';
import KanbanColumn from './KanbanColumn';
import { KANBAN_COLUMNS, groupSessionsByColumn } from './kanban-utils';

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

function KanbanLayout(): React.JSX.Element {
  const boardRef = useRef<HTMLDivElement>(null);
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const selectSession = useSessionStore((s) => s.selectSession);
  const kanbanExpandedSessionId = useLayoutStore((s) => s.kanbanExpandedSessionId);
  const expandKanbanSession = useLayoutStore((s) => s.expandKanbanSession);
  const clearKanbanExpand = useLayoutStore((s) => s.clearKanbanExpand);

  const grouped = groupSessionsByColumn(sessions);

  // Auto-collapse if expanded session is deleted
  useEffect(() => {
    if (kanbanExpandedSessionId && !sessions[kanbanExpandedSessionId]) {
      clearKanbanExpand();
    }
  }, [kanbanExpandedSessionId, sessions, clearKanbanExpand]);

  const handleSelectSession = useCallback((sessionId: string) => {
    selectSession(sessionId);
    // Focus the board so it can receive Cmd+Enter keyboard events
    boardRef.current?.focus();
  }, [selectSession]);

  const handleExpandSession = useCallback((sessionId: string) => {
    selectSession(sessionId);
    expandKanbanSession(sessionId);
  }, [selectSession, expandKanbanSession]);

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

  // If a session is expanded, show its full terminal
  if (kanbanExpandedSessionId && sessions[kanbanExpandedSessionId]) {
    return (
      <div className="h-full w-full">
        <TerminalTile sessionId={kanbanExpandedSessionId} />
      </div>
    );
  }

  // Kanban board view
  const isEmpty = Object.keys(sessions).length === 0;

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
          sessions={grouped[column.id]}
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
