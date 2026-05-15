import { useState, useEffect } from 'react';
import { getLeaves } from 'react-mosaic-component';
import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';
import { useTaskStore } from '../stores/task-store';
import { useEditorStore } from '../stores/editor-store';
import { useTerminalStore } from '../stores/terminal-store';
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

  // Drop bottom-panel terminals whose session is ended or gone. Terminals are
  // killed on app quit (see main/index.ts before-quit) so restoring them as
  // blank tabs would contradict the close-confirmation dialog. The mosaic
  // ended-session prompt doesn't apply here — a shell has no resume semantics.
  const sessionById = new Map(allSessions.map((s) => [s.sessionId, s]));
  const panelTerminalIds = Object.keys(useTerminalPanelStore.getState().terminals);
  const staleTerminals = new Set(
    panelTerminalIds.filter((id) => {
      const s = sessionById.get(id);
      return !s || s.status === 'ended';
    }),
  );
  useTerminalPanelStore.getState().pruneTerminals(staleTerminals);

  // Strip temporary file viewer tiles from previous session
  useLayoutStore.getState().stripFileTiles();

  // Migrate terminal-type session tiles from mosaic to bottom panel
  const { mosaicTree } = useLayoutStore.getState();
  if (mosaicTree) {
    const leaves = getLeaves(mosaicTree);
    for (const leaf of leaves) {
      const sid = sessionIdFromTileId(leaf);
      if (!sid) continue;
      const sess = sessionById.get(sid);
      if (sess?.sessionType === 'terminal') {
        if (sess.status !== 'ended') {
          useTerminalPanelStore.getState().addTerminal({
            sessionId: sid,
            label: sess.label || 'Terminal',
            cwd: sess.cwd,
            repo: basename(sess.cwd),
          });
        }
        useLayoutStore.getState().removeTile(sid);
      }
    }
    useLayoutStore.getState().persist();
  }

  // Load editor preferences (vim mode, etc.)
  await useEditorStore.getState().load();

  // Load terminal preferences (scrollback-erase suppression, etc.)
  await useTerminalStore.getState().load();

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
