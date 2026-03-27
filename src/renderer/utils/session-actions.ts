import { basename } from '../utils/path-utils';
import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';
import { useTerminalPanelStore, type SplitDirection } from '../stores/terminal-panel-store';

/** Auto-expand a newly created session when in kanban view mode. */
export function autoExpandInKanban(sessionId: string): void {
  const { viewMode, expandKanbanSession } = useLayoutStore.getState();
  if (viewMode === 'kanban') {
    expandKanbanSession(sessionId);
  }
}

/**
 * Create a new terminal session using the selected session's cwd (or $HOME).
 * The terminal is added to the bottom terminal panel, not the mosaic layout.
 */
export async function createTerminalSession(tabGroupId?: string): Promise<void> {
  const { sessions, selectedSessionId } = useSessionStore.getState();
  const selectedSession = selectedSessionId ? sessions[selectedSessionId] : null;
  const cwd = selectedSession?.cwd || window.mcode.app.getHomeDir();

  const session = await window.mcode.sessions.create({
    cwd,
    sessionType: 'terminal',
  });

  useSessionStore.getState().addSession(session);

  // Add to terminal panel instead of mosaic tiles
  useTerminalPanelStore.getState().addTerminal(
    {
      sessionId: session.sessionId,
      label: session.label || 'Terminal',
      cwd,
      repo: basename(cwd),
    },
    tabGroupId,
  );
}

/**
 * Split a terminal tab group and create a new terminal in the new pane.
 */
export async function splitAndCreateTerminal(
  tabGroupId: string,
  direction: SplitDirection,
): Promise<void> {
  const newGroupId = useTerminalPanelStore.getState().splitTabGroup(tabGroupId, direction);
  if (newGroupId) {
    await createTerminalSession(newGroupId);
  }
}

/** Resolve the CWD from the selected session or most recent session, falling back to $HOME. */
export function resolveActiveCwd(): string {
  const { sessions, selectedSessionId } = useSessionStore.getState();
  const selectedSession = selectedSessionId ? sessions[selectedSessionId] : null;
  if (selectedSession) return selectedSession.cwd;

  // Fallback: most recently created session's cwd
  const sorted = Object.values(sessions).sort(
    (a, b) => b.startedAt.localeCompare(a.startedAt),
  );
  return sorted[0]?.cwd ?? window.mcode.app.getHomeDir();
}

/**
 * Run a shell command in a new terminal tab in the bottom panel.
 */
export async function runShellCommand(
  commandString: string,
  cwd?: string,
): Promise<void> {
  const effectiveCwd = cwd ?? resolveActiveCwd();

  const session = await window.mcode.sessions.create({
    cwd: effectiveCwd,
    sessionType: 'terminal',
    label: commandString,
    initialCommand: commandString,
  });

  useTerminalPanelStore.getState().addTerminal({
    sessionId: session.sessionId,
    label: commandString,
    cwd: effectiveCwd,
    repo: basename(effectiveCwd),
  });
}
