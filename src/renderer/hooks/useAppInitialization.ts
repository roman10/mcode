import { useState, useEffect } from 'react';
import { getLeaves } from 'react-mosaic-component';
import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';
import { useTaskStore } from '../stores/task-store';
import { useEditorStore } from '../stores/editor-store';
import { useAccountsStore } from '../stores/accounts-store';
import { useTerminalPanelStore } from '../stores/terminal-panel-store';
import { sessionIdFromTileId } from '../utils/tile-id';
import { basename } from '../utils/path-utils';

/**
 * Core async initialization logic — loads all app data from the main process
 * and hydrates the Zustand stores. Exported separately for testing.
 *
 * @param signal - Cancellation token; checks `signal.cancelled` after each
 *   async step to avoid state updates after component unmount.
 */
export async function loadInitialData(signal: { cancelled: boolean }): Promise<void> {
  // Load sessions from SQLite
  const allSessions = await window.mcode.sessions.list();
  if (signal.cancelled) return;
  useSessionStore.getState().setSessions(allSessions);

  // Load hook runtime info
  const runtime = await window.mcode.hooks.getRuntime();
  if (signal.cancelled) return;
  useSessionStore.getState().setHookRuntime(runtime);

  // Restore layout from SQLite
  await useLayoutStore.getState().restore();
  if (signal.cancelled) return;

  // Prune tiles for sessions that no longer exist in the DB
  // (ended sessions are kept so they can show the resume prompt)
  const allIds = new Set(allSessions.map((s) => s.sessionId));
  useLayoutStore.getState().pruneTiles(allIds);

  // Strip temporary file viewer tiles from previous session
  useLayoutStore.getState().stripFileTiles();

  // Migrate terminal-type session tiles from mosaic to bottom panel
  const { mosaicTree } = useLayoutStore.getState();
  if (mosaicTree) {
    const leaves = getLeaves(mosaicTree);
    for (const leaf of leaves) {
      const sid = sessionIdFromTileId(leaf);
      if (!sid) continue;
      const sess = allSessions.find((s) => s.sessionId === sid);
      if (sess?.sessionType === 'terminal') {
        useTerminalPanelStore.getState().addTerminal({
          sessionId: sid,
          label: sess.label || 'Terminal',
          cwd: sess.cwd,
          repo: basename(sess.cwd),
        });
        useLayoutStore.getState().removeTile(sid);
      }
    }
    useLayoutStore.getState().persist();
  }

  // Load editor preferences (vim mode, etc.)
  await useEditorStore.getState().load();

  // Load accounts (non-blocking, used by AccountsDialog and SessionCard)
  useAccountsStore.getState().refresh().catch(() => {});
  // Check CLI installation / auth status for sidebar banner
  useAccountsStore.getState().refreshCliStatus().catch(() => {});

  // Load task queue
  const tasks = await window.mcode.tasks.list();
  if (signal.cancelled) return;
  useTaskStore.getState().setTasks(tasks);

  // Load external Claude Code sessions (non-blocking, initial page)
  window.mcode.sessions.listExternal(20).then((ext) => {
    if (!signal.cancelled) useSessionStore.getState().setExternalSessions(ext);
  }).catch(() => {});
}

/** Loads all app data on mount and returns loading/error state. */
export function useAppInitialization(): { loading: boolean; error: string | null } {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const signal = { cancelled: false };

    loadInitialData(signal)
      .then(() => { if (!signal.cancelled) setLoading(false); })
      .catch((err) => {
        if (!signal.cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => { signal.cancelled = true; };
  }, []);

  return { loading, error };
}
