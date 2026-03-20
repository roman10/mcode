import { basename } from '../utils/path-utils';
import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';
import { useEphemeralCommandStore } from '../stores/ephemeral-command-store';

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

/** Resolve the CWD for ephemeral commands: selected session's cwd or $HOME. */
export function resolveEphemeralCwd(): string {
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
 * Run an ephemeral shell command. Creates a background terminal session
 * that auto-deletes on completion. Output is captured in the renderer store.
 */
export async function runEphemeralCommand(
  commandString: string,
  cwd?: string,
): Promise<void> {
  const effectiveCwd = cwd ?? resolveEphemeralCwd();
  const id = crypto.randomUUID();

  const session = await window.mcode.sessions.create({
    cwd: effectiveCwd,
    command: '/bin/sh',
    args: ['-c', commandString],
    sessionType: 'terminal',
    ephemeral: true,
    label: commandString,
  });

  useEphemeralCommandStore.getState().addCommand({
    id,
    sessionId: session.sessionId,
    command: commandString,
    cwd: effectiveCwd,
    repo: basename(effectiveCwd),
    status: 'running',
    exitCode: null,
    output: '',
    startedAt: Date.now(),
    endedAt: null,
  });
}
