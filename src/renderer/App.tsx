import { useEffect, useRef, useState } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import Sidebar from './components/Sidebar/Sidebar';
import MosaicLayout from './components/Layout/MosaicLayout';
import KeyboardShortcutsDialog from './components/KeyboardShortcutsDialog';
import SettingsDialog from './components/SettingsDialog';
import AccountsDialog from './components/AccountsDialog';
import CommandPalette from './components/CommandPalette';
import { useSessionStore } from './stores/session-store';
import { useLayoutStore } from './stores/layout-store';
import { useTaskStore } from './stores/task-store';
import { useEditorStore } from './stores/editor-store';
import { useAccountsStore } from './stores/accounts-store';
import { executeAppCommand } from './utils/app-commands';
import TitleBar from './components/TitleBar';
import CreateTaskDialog from './components/shared/CreateTaskDialog';
import type { CreateTaskInput } from '../shared/types';

function App(): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setSessions = useSessionStore((s) => s.setSessions);
  const setExternalSessions = useSessionStore((s) => s.setExternalSessions);
  const upsertSession = useSessionStore((s) => s.upsertSession);
  const addSession = useSessionStore((s) => s.addSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const setHookRuntime = useSessionStore((s) => s.setHookRuntime);
  const restore = useLayoutStore((s) => s.restore);
  const pruneTiles = useLayoutStore((s) => s.pruneTiles);
  const stripFileTiles = useLayoutStore((s) => s.stripFileTiles);
  const addTile = useLayoutStore((s) => s.addTile);
  const removeTile = useLayoutStore((s) => s.removeTile);
  const persist = useLayoutStore((s) => s.persist);
  const flushPersist = useLayoutStore((s) => s.flushPersist);
  const setTasks = useTaskStore((s) => s.setTasks);
  const upsertTask = useTaskStore((s) => s.upsertTask);
  const removeTask = useTaskStore((s) => s.removeTask);

  // Track previous high-attention count for dock badge
  const prevHighCountRef = useRef(0);
  const prevAttentionBySessionRef = useRef<Record<string, string>>({});

  // Load sessions and layout on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Load sessions from SQLite
        const allSessions = await window.mcode.sessions.list();
        if (cancelled) return;
        setSessions(allSessions);

        // Load hook runtime info
        const runtime = await window.mcode.hooks.getRuntime();
        if (cancelled) return;
        setHookRuntime(runtime);

        // Restore layout from SQLite
        await restore();
        if (cancelled) return;

        // Prune tiles for sessions that no longer exist in the DB
        // (ended sessions are kept so they can show the resume prompt)
        const allIds = new Set(allSessions.map((s) => s.sessionId));
        pruneTiles(allIds);

        // Strip ephemeral file viewer tiles from previous session
        stripFileTiles();

        // Load editor preferences (vim mode, etc.)
        await useEditorStore.getState().load();

        // Load accounts (non-blocking, used by AccountsDialog and SessionCard)
        useAccountsStore.getState().refresh().catch(() => {});

        // Load task queue
        const tasks = await window.mcode.tasks.list();
        if (cancelled) return;
        setTasks(tasks);

        // Load external Claude Code sessions (non-blocking, initial page)
        window.mcode.sessions.listExternal(20).then((ext) => {
          if (!cancelled) setExternalSessions(ext);
        }).catch(() => {});

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for full session updates from main process (replaces onStatusChange)
  // Also fires system notifications for newly raised high attention
  useEffect(() => {
    const unsub = window.mcode.sessions.onUpdated((session) => {
      const previousAttention = prevAttentionBySessionRef.current[session.sessionId];
      prevAttentionBySessionRef.current[session.sessionId] = session.attentionLevel;

      upsertSession(session);

      // System notification only when high attention is newly raised.
      if (
        session.attentionLevel === 'high' &&
        previousAttention !== 'high' &&
        !document.hasFocus() &&
        Notification.permission === 'granted'
      ) {
        new Notification('mcode — Attention needed', {
          body: session.attentionReason ?? `Session "${session.label}" needs attention`,
        });
      }
    });
    return unsub;
  }, [upsertSession]);

  // Listen for sessions created externally (e.g. via MCP devtools)
  // Skip ephemeral sessions — they should not appear in sidebar or create tiles
  useEffect(() => {
    const unsub = window.mcode.sessions.onCreated((session) => {
      if (session.ephemeral) return;
      addSession(session);
      addTile(session.sessionId);
      persist();
    });
    return unsub;
  }, [addSession, addTile, persist]);

  // Listen for sessions deleted (from UI or MCP devtools)
  useEffect(() => {
    const unsub = window.mcode.sessions.onDeleted((sessionId) => {
      removeSession(sessionId);
      removeTile(sessionId);
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
      } else {
        removeTask(event.taskId);
      }
    });
    return unsub;
  }, [upsertTask, removeTask]);

  // Dock badge: count of high-attention sessions
  useEffect(() => {
    return useSessionStore.subscribe((state) => {
      const highCount = Object.values(state.sessions).filter(
        (s) => s.attentionLevel === 'high',
      ).length;

      if (highCount !== prevHighCountRef.current) {
        prevHighCountRef.current = highCount;
        window.mcode.app.setDockBadge(highCount > 0 ? String(highCount) : '');
      }
    });
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (): void => {
      flushPersist();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [flushPersist]);

  // Prevent browser from navigating to files dropped outside a terminal
  useEffect(() => {
    const prevent = (e: DragEvent): void => {
      e.preventDefault();
    };
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => {
      document.removeEventListener('dragover', prevent);
      document.removeEventListener('drop', prevent);
    };
  }, []);

  // App command handling (menu accelerators dispatched from main process)
  useEffect(() => {
    const unsub = window.mcode.app.onCommand(executeAppCommand);
    return unsub;
  }, []);

  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const showKeyboardShortcuts = useLayoutStore((s) => s.showKeyboardShortcuts);
  const setShowKeyboardShortcuts = useLayoutStore((s) => s.setShowKeyboardShortcuts);
  const showSettings = useLayoutStore((s) => s.showSettings);
  const setShowSettings = useLayoutStore((s) => s.setShowSettings);
  const showAccountsDialog = useLayoutStore((s) => s.showAccountsDialog);
  const setShowAccountsDialog = useLayoutStore((s) => s.setShowAccountsDialog);
  const showCommandPalette = useLayoutStore((s) => s.showCommandPalette);
  const setShowCommandPalette = useLayoutStore((s) => s.setShowCommandPalette);
  const quickOpenInitialMode = useLayoutStore((s) => s.quickOpenInitialMode);
  const showCreateTaskDialog = useLayoutStore((s) => s.showCreateTaskDialog);
  const setShowCreateTaskDialog = useLayoutStore((s) => s.setShowCreateTaskDialog);
  const addTask = useTaskStore((s) => s.addTask);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const selectedSession = useSessionStore((s) => selectedSessionId ? s.sessions[selectedSessionId] : null);

  if (error) {
    return (
      <div className="flex flex-col h-screen w-screen bg-bg-primary">
        <TitleBar />
        <div className="flex flex-1 min-h-0 items-center justify-center">
          <span className="text-red-400">Failed to initialize: {error}</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col h-screen w-screen bg-bg-primary">
        <TitleBar />
        <div className="flex flex-1 min-h-0 items-center justify-center">
          <span className="text-text-secondary">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <RadixTooltip.Provider delayDuration={200}>
      <div className="flex flex-col h-screen w-screen bg-bg-primary">
        <TitleBar />

        {/* Main content: sidebar + mosaic */}
        <div className="flex flex-1 min-h-0">
          {!sidebarCollapsed && <Sidebar />}
          <div className="flex-1 min-w-0">
            <MosaicLayout />
          </div>
        </div>
      </div>
      {showKeyboardShortcuts && (
        <KeyboardShortcutsDialog onClose={() => setShowKeyboardShortcuts(false)} />
      )}
      {showSettings && (
        <SettingsDialog onClose={() => setShowSettings(false)} />
      )}
      {showAccountsDialog && (
        <AccountsDialog onClose={() => setShowAccountsDialog(false)} />
      )}
      {showCommandPalette && (
        <CommandPalette
          initialMode={quickOpenInitialMode}
          onClose={() => setShowCommandPalette(false)}
        />
      )}
      {showCreateTaskDialog && (() => {
        const canTarget =
          selectedSession?.sessionType === 'claude' &&
          selectedSession?.hookMode === 'live' &&
          selectedSession?.status !== 'ended';
        return (
          <CreateTaskDialog
            onClose={() => setShowCreateTaskDialog(false)}
            onCreate={async (input: CreateTaskInput) => {
              try {
                await addTask(input);
              } catch (err) {
                console.error('Failed to create task:', err);
              }
              setShowCreateTaskDialog(false);
            }}
            defaultTargetSessionId={canTarget ? selectedSessionId ?? undefined : undefined}
            defaultCwd={canTarget ? selectedSession?.cwd : undefined}
          />
        );
      })()}
    </RadixTooltip.Provider>
  );
}

export default App;
