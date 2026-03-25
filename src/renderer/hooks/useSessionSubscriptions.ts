import { useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';
import { useTaskStore } from '../stores/task-store';
import { useSearchStore } from '../stores/search-store';
import { useTerminalPanelStore } from '../stores/terminal-panel-store';
import { basename } from '../utils/path-utils';

/**
 * Registers IPC push subscriptions for session, task, PTY, and search events.
 * Each subscription is cleaned up when the component unmounts.
 */
export function useSessionSubscriptions(): void {
  const prevAttentionBySession = useRef<Record<string, string>>({});

  const upsertSession = useSessionStore((s) => s.upsertSession);
  const addSession = useSessionStore((s) => s.addSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const removeTile = useLayoutStore((s) => s.removeTile);
  const addTile = useLayoutStore((s) => s.addTile);
  const persist = useLayoutStore((s) => s.persist);
  const upsertTask = useTaskStore((s) => s.upsertTask);
  const removeTask = useTaskStore((s) => s.removeTask);
  const refreshTasks = useTaskStore((s) => s.refreshTasks);

  // Listen for full session updates from main process.
  // Also fires system notifications for newly raised high attention.
  useEffect(() => {
    const unsub = window.mcode.sessions.onUpdated((session) => {
      const previousAttention = prevAttentionBySession.current[session.sessionId];
      prevAttentionBySession.current[session.sessionId] = session.attentionLevel;

      // Check if session just transitioned to ended (before upsert updates the store)
      const prevStatus = useSessionStore.getState().sessions[session.sessionId]?.status;
      const justEnded = session.status === 'ended' && prevStatus !== 'ended';

      upsertSession(session);

      // Auto-remove tile when session transitions to ended.
      // This centralised cleanup is needed because in kanban mode TerminalTile
      // components are not mounted for non-expanded sessions, so their
      // auto-close useEffect never fires and zombie tiles accumulate.
      if (justEnded) {
        removeTile(session.sessionId);
        persist();
      }

      // System notification only when action attention is newly raised.
      if (
        session.attentionLevel === 'action' &&
        previousAttention !== 'action' &&
        !document.hasFocus() &&
        Notification.permission === 'granted'
      ) {
        new Notification('mcode — Attention needed', {
          body: session.attentionReason ?? `Session "${session.label}" needs attention`,
        });
      }
    });
    return unsub;
  }, [upsertSession, removeTile, persist]);

  // Listen for sessions created externally (e.g. via MCP devtools).
  // Terminal sessions go to the bottom panel; Claude sessions go to mosaic tiles.
  useEffect(() => {
    const unsub = window.mcode.sessions.onCreated((session) => {
      addSession(session);
      if (session.sessionType === 'terminal') {
        // Route to terminal panel instead of mosaic layout
        useTerminalPanelStore.getState().addTerminal({
          sessionId: session.sessionId,
          label: session.label || 'Terminal',
          cwd: session.cwd,
          repo: basename(session.cwd),
        });
      } else {
        addTile(session.sessionId);
        persist();
      }
    });
    return unsub;
  }, [addSession, addTile, persist]);

  // Listen for sessions deleted (from UI or MCP devtools)
  useEffect(() => {
    const unsub = window.mcode.sessions.onDeleted((sessionId) => {
      removeSession(sessionId);
      removeTile(sessionId);
      // Also remove from terminal panel if it's a terminal session
      useTerminalPanelStore.getState().removeTerminal(sessionId);
      persist();
    });
    return unsub;
  }, [removeSession, removeTile, persist]);

  // Listen for batch session deletions
  useEffect(() => {
    const unsub = window.mcode.sessions.onDeletedBatch((sessionIds) => {
      for (const id of sessionIds) {
        removeSession(id);
        removeTile(id);
        useTerminalPanelStore.getState().removeTerminal(id);
      }
      persist();
    });
    return unsub;
  }, [removeSession, removeTile, persist]);

  // Listen for task queue changes
  useEffect(() => {
    const unsub = window.mcode.tasks.onChanged((event) => {
      if (event.type === 'upsert') {
        upsertTask(event.task);
      } else if (event.type === 'remove') {
        removeTask(event.taskId);
      } else {
        refreshTasks();
      }
    });
    return unsub;
  }, [upsertTask, removeTask, refreshTasks]);

  // Route pty:exit events to session exit codes
  useEffect(() => {
    const unsub = window.mcode.pty.onExit((sessionId, payload) => {
      useSessionStore.getState().setExitCode(sessionId, payload.code);
    });
    return unsub;
  }, []);

  // Route search events to search store
  useEffect(() => {
    const unsub = window.mcode.search.onEvent((event) => {
      useSearchStore.getState().handleEvent(event);
    });
    return unsub;
  }, []);
}
