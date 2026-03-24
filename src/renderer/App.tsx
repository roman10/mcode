import { useEffect, useRef, useState } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import ActivityBar from './components/Sidebar/ActivityBar';
import SidebarPanel from './components/Sidebar/SidebarPanel';
import { getLeaves } from 'react-mosaic-component';
import MosaicLayout from './components/Layout/MosaicLayout';
import KanbanLayout from './components/Kanban/KanbanLayout';
import KeyboardShortcutsDialog from './components/KeyboardShortcutsDialog';
import SettingsDialog from './components/SettingsDialog';
import AccountsDialog from './components/AccountsDialog';
import CommandPalette from './components/CommandPalette';
import TerminalPanel from './components/TerminalPanel/TerminalPanel';
import StatusBar from './components/TerminalPanel/StatusBar';
import { useSessionStore } from './stores/session-store';
import { useLayoutStore, sessionIdFromTileId } from './stores/layout-store';
import { useTaskStore } from './stores/task-store';
import { useEditorStore } from './stores/editor-store';
import { useAccountsStore } from './stores/accounts-store';
import { useChangesStore } from './stores/changes-store';
import { useTerminalPanelStore } from './stores/terminal-panel-store';
import { useSearchStore } from './stores/search-store';
import { executeAppCommand } from './utils/app-commands';
import { basename } from './utils/path-utils';
import TitleBar from './components/TitleBar';
import CreateTaskDialog from './components/shared/CreateTaskDialog';
import type { CreateTaskInput, SidebarTab } from '@shared/types';

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
  const refreshTasks = useTaskStore((s) => s.refreshTasks);

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

        // Strip temporary file viewer tiles from previous session
        stripFileTiles();

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
  }, [upsertSession]);

  // Listen for sessions created externally (e.g. via MCP devtools)
  // Terminal sessions go to the bottom panel; Claude sessions go to mosaic tiles
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

  // pty:data events are handled directly by TerminalInstance (no central routing needed).

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

  // Dock badge: count of action-attention sessions (those requiring user input)
  useEffect(() => {
    return useSessionStore.subscribe((state) => {
      const highCount = Object.values(state.sessions).filter(
        (s) => s.attentionLevel === 'action',
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

  // Fallback Cmd+W: when focus is outside tiles (sidebar, empty layout, etc.),
  // close a non-session viewer tile first; only close the window when none remain.
  useEffect(() => {
    const isMac = navigator.userAgent.includes('Mac');
    const handleKeyDown = (e: KeyboardEvent): void => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'w' && !e.shiftKey) {
        // Skip when a dialog/modal is open — let the dialog handle dismissal
        if (document.querySelector('[role="dialog"]')) {
          return;
        }
        e.preventDefault();

        // Close a non-session tile (viewer) before closing the window
        const { mosaicTree, removeAnyTile, persist } = useLayoutStore.getState();
        if (mosaicTree) {
          const leaves = getLeaves(mosaicTree);
          const closable = leaves.findLast((id) => !id.startsWith('session:'));
          if (closable) {
            removeAnyTile(closable);
            persist();
            return;
          }
        }
        window.close();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const activeSidebarTab = useLayoutStore((s) => s.activeSidebarTab);
  const setActiveSidebarTab = useLayoutStore((s) => s.setActiveSidebarTab);
  const viewMode = useLayoutStore((s) => s.viewMode);

  const attentionCount = useSessionStore((s) =>
    Object.values(s.sessions).filter((sess) => sess.attentionLevel === 'action').length,
  );

  const changesCount = useChangesStore((s) =>
    s.statuses.reduce((sum, status) => sum + status.staged.length + status.unstaged.length, 0),
  );

  const handleActivityBarTabSelect = (tab: SidebarTab): void => {
    if (sidebarCollapsed) {
      setActiveSidebarTab(tab);
      toggleSidebar();
    } else if (activeSidebarTab === tab) {
      toggleSidebar();
    } else {
      setActiveSidebarTab(tab);
    }
  };
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

        {/* Main content: activity bar + sidebar panel + layout */}
        <div className="flex flex-1 min-h-0">
          <ActivityBar
            activeTab={activeSidebarTab}
            panelCollapsed={sidebarCollapsed}
            onTabSelect={handleActivityBarTabSelect}
            onSettingsClick={() => setShowSettings(true)}
            onAccountsClick={() => setShowAccountsDialog(true)}
            attentionCount={attentionCount}
            changesCount={changesCount}
          />
          {!sidebarCollapsed && <SidebarPanel />}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 min-h-0">
              {viewMode === 'kanban' ? <KanbanLayout /> : <MosaicLayout />}
            </div>
            <TerminalPanel />
            <StatusBar />
          </div>
        </div>
      </div>
      <KeyboardShortcutsDialog
        open={showKeyboardShortcuts}
        onOpenChange={setShowKeyboardShortcuts}
      />
      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
      />
      <AccountsDialog
        open={showAccountsDialog}
        onOpenChange={setShowAccountsDialog}
      />
      {showCommandPalette && (
        <CommandPalette
          initialMode={quickOpenInitialMode}
          onClose={() => setShowCommandPalette(false)}
        />
      )}
      <CreateTaskDialog
        open={showCreateTaskDialog}
        onOpenChange={setShowCreateTaskDialog}
        onCreate={async (input: CreateTaskInput) => {
          try {
            await addTask(input);
          } catch (err) {
            console.error('Failed to create task:', err);
          }
          setShowCreateTaskDialog(false);
        }}
        defaultTargetSessionId={
          selectedSession?.sessionType === 'claude' &&
          selectedSession?.hookMode === 'live' &&
          selectedSession?.status !== 'ended'
            ? selectedSessionId ?? undefined
            : undefined
        }
        defaultCwd={
          selectedSession?.sessionType === 'claude' &&
          selectedSession?.hookMode === 'live' &&
          selectedSession?.status !== 'ended'
            ? selectedSession?.cwd
            : undefined
        }
      />
    </RadixTooltip.Provider>
  );
}

export default App;
