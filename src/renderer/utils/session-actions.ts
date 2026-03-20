import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';

/** Auto-expand a newly created session when in kanban view mode. */
export function autoExpandInKanban(sessionId: string): void {
  const { viewMode, expandKanbanSession } = useLayoutStore.getState();
  if (viewMode === 'kanban') {
    expandKanbanSession(sessionId);
  }
}

/**
 * Create a new terminal session using the selected session's cwd (or $HOME).
 * Standalone function so it can be called from both Sidebar and App.tsx command handling.
 */
export async function createTerminalSession(): Promise<void> {
  const { sessions, selectedSessionId } = useSessionStore.getState();
  const selectedSession = selectedSessionId ? sessions[selectedSessionId] : null;
  const cwd = selectedSession?.cwd || window.mcode.app.getHomeDir();

  const session = await window.mcode.sessions.create({
    cwd,
    sessionType: 'terminal',
  });

  useSessionStore.getState().addSession(session);
  useLayoutStore.getState().addTile(session.sessionId);
  useLayoutStore.getState().persist();
  useSessionStore.getState().selectSession(session.sessionId);
  autoExpandInKanban(session.sessionId);
}
