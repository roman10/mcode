import { useEffect } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import ActivityBar from './components/Sidebar/ActivityBar';
import SidebarPanel from './components/Sidebar/SidebarPanel';
import { getLeaves } from 'react-mosaic-component';
import MosaicLayout from './components/Layout/MosaicLayout';
import KanbanLayout from './components/Kanban/KanbanLayout';
import KeyboardShortcutsDialog from './components/KeyboardShortcutsDialog';
import SettingsDialog from './components/SettingsDialog';
import AccountsDialog from './components/AccountsDialog';
import CommandPalette from './components/CommandPalette/CommandPalette';
import TerminalPanel from './components/BottomPanel/TerminalPanel';
import StatusBar from './components/BottomPanel/StatusBar';
import { useSessionStore } from './stores/session-store';
import { useLayoutStore } from './stores/layout-store';
import { useDialogStore } from './stores/dialog-store';
import { useTaskStore } from './stores/task-store';
import { useChangesStore } from './stores/changes-store';
import { executeAppCommand } from './utils/app-commands';
import TitleBar from './components/TitleBar';
import CreateTaskDialog from './components/shared/CreateTaskDialog';
import { useAppInitialization } from './hooks/useAppInitialization';
import { useSessionSubscriptions } from './hooks/useSessionSubscriptions';
import { canSessionBeDefaultTaskTarget } from '@shared/session-capabilities';
import type { CreateTaskInput, SidebarTab } from '@shared/types';

function App(): React.JSX.Element {
  const { loading, error } = useAppInitialization();
  useSessionSubscriptions();

  const flushPersist = useLayoutStore((s) => s.flushPersist);

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

  // Dock badge: count of action-attention sessions (those requiring user input)
  useEffect(() => {
    let prevCount = 0;
    return useSessionStore.subscribe((state) => {
      const highCount = Object.values(state.sessions).filter(
        (s) => s.attentionLevel === 'action',
      ).length;
      if (highCount !== prevCount) {
        prevCount = highCount;
        window.mcode.app.setDockBadge(highCount > 0 ? String(highCount) : '');
      }
    });
  }, []);

  const sidebarCollapsed = useLayoutStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const activeSidebarTab = useLayoutStore((s) => s.activeSidebarTab);
  const setActiveSidebarTab = useLayoutStore((s) => s.setActiveSidebarTab);
  const showActivityTab = useLayoutStore((s) => s.showActivityTab);
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
  const showKeyboardShortcuts = useDialogStore((s) => s.showKeyboardShortcuts);
  const setShowKeyboardShortcuts = useDialogStore((s) => s.setShowKeyboardShortcuts);
  const showSettings = useDialogStore((s) => s.showSettings);
  const setShowSettings = useDialogStore((s) => s.setShowSettings);
  const showAccountsDialog = useDialogStore((s) => s.showAccountsDialog);
  const setShowAccountsDialog = useDialogStore((s) => s.setShowAccountsDialog);
  const showCommandPalette = useDialogStore((s) => s.showCommandPalette);
  const setShowCommandPalette = useDialogStore((s) => s.setShowCommandPalette);
  const quickOpenInitialMode = useDialogStore((s) => s.quickOpenInitialMode);
  const showCreateTaskDialog = useDialogStore((s) => s.showCreateTaskDialog);
  const setShowCreateTaskDialog = useDialogStore((s) => s.setShowCreateTaskDialog);
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
            showActivityTab={showActivityTab}
          />
          {!sidebarCollapsed && <SidebarPanel />}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 min-h-0">
              {viewMode === 'kanban' ? <KanbanLayout /> : <MosaicLayout />}
            </div>
            <TerminalPanel />
          </div>
        </div>
        {/* StatusBar lives outside the editor/panel split so it can never be clipped */}
        <StatusBar />
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
          canSessionBeDefaultTaskTarget(selectedSession)
            ? selectedSessionId ?? undefined
            : undefined
        }
        defaultCwd={
          canSessionBeDefaultTaskTarget(selectedSession)
            ? selectedSession?.cwd
            : undefined
        }
      />
    </RadixTooltip.Provider>
  );
}

export default App;
