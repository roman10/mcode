import type { AppCommand, SessionInfo } from '@shared/types';
import { getLeaves } from 'react-mosaic-component';
import { useLayoutStore, sessionIdFromTileId } from '../stores/layout-store';
import { useSessionStore } from '../stores/session-store';
import { useTerminalPanelStore } from '../stores/terminal-panel-store';
import { getOrderedOpenSessions } from './session-ordering';
import { createTerminalSession } from './session-actions';

/** Sessions navigable by focus commands — in tile mode, only those with visible tiles. */
function getNavigableSessions(): SessionInfo[] {
  const { viewMode, mosaicTree } = useLayoutStore.getState();
  const ordered = getOrderedOpenSessions(useSessionStore.getState().sessions);
  if (viewMode === 'tiles') {
    if (!mosaicTree) return [];
    const visibleIds = new Set(
      getLeaves(mosaicTree).map(sessionIdFromTileId).filter(Boolean),
    );
    return ordered.filter((s) => visibleIds.has(s.sessionId));
  }
  return ordered;
}

/**
 * Execute an AppCommand dispatched from the Electron menu or command palette.
 * Extracted from App.tsx so it can be called from both the IPC listener and the palette.
 */
export function executeAppCommand(command: AppCommand): void {
  switch (command.command) {
    case 'new-session':
      useLayoutStore.getState().setShowNewSessionDialog(true);
      break;

    case 'new-terminal':
      createTerminalSession().catch(console.error);
      break;

    case 'toggle-sidebar':
      useLayoutStore.getState().toggleSidebar();
      break;

    case 'show-keyboard-shortcuts': {
      const ls = useLayoutStore.getState();
      ls.setShowKeyboardShortcuts(!ls.showKeyboardShortcuts);
      break;
    }

    case 'focus-session-index': {
      const ordered = getNavigableSessions();
      const target = ordered[command.index];
      if (!target) break;
      useLayoutStore.getState().addTile(target.sessionId);
      useLayoutStore.getState().persist();
      useSessionStore.getState().selectSession(target.sessionId);
      break;
    }

    case 'focus-next-session':
    case 'focus-prev-session': {
      const selectedId = useSessionStore.getState().selectedSessionId;
      const ordered = getNavigableSessions();
      if (ordered.length === 0) break;

      const currentIdx = selectedId
        ? ordered.findIndex((s) => s.sessionId === selectedId)
        : -1;

      let nextIdx: number;
      if (command.command === 'focus-next-session') {
        nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % ordered.length;
      } else {
        nextIdx = currentIdx < 0 ? ordered.length - 1 : (currentIdx - 1 + ordered.length) % ordered.length;
      }

      const next = ordered[nextIdx];
      useLayoutStore.getState().addTile(next.sessionId);
      useLayoutStore.getState().persist();
      useSessionStore.getState().selectSession(next.sessionId);
      break;
    }

    case 'show-settings': {
      const ls = useLayoutStore.getState();
      ls.setShowSettings(!ls.showSettings);
      break;
    }

    case 'switch-sidebar-tab': {
      const store = useLayoutStore.getState();
      // If switching to the activity tab while it's hidden, make it visible first
      if (command.tab === 'activity' && !store.showActivityTab) {
        store.setShowActivityTab(true);
      }
      if (store.sidebarCollapsed) {
        // Panel collapsed: expand to the requested tab
        store.setActiveSidebarTab(command.tab);
        store.toggleSidebar();
      } else if (store.activeSidebarTab === command.tab) {
        // Same tab: collapse the panel
        store.toggleSidebar();
      } else {
        store.setActiveSidebarTab(command.tab);
      }
      break;
    }

    case 'clear-all-attention':
      window.mcode.sessions.clearAllAttention().catch(console.error);
      break;

    case 'close-all-tiles':
      useLayoutStore.getState().removeAllTiles();
      useLayoutStore.getState().persist();
      break;

    case 'show-command-palette': {
      const ls = useLayoutStore.getState();
      ls.setShowSettings(false);
      ls.setShowKeyboardShortcuts(false);
      if (ls.showCommandPalette) {
        ls.setShowCommandPalette(false);
      } else {
        ls.openQuickOpen('commands');
      }
      break;
    }

    case 'show-create-task':
      useLayoutStore.getState().setShowCreateTaskDialog(true);
      break;

    case 'quick-open': {
      const ls = useLayoutStore.getState();
      ls.setShowSettings(false);
      ls.setShowKeyboardShortcuts(false);
      if (ls.showCommandPalette) {
        ls.setShowCommandPalette(false);
      } else {
        ls.openQuickOpen('files');
      }
      break;
    }

    case 'set-view-mode':
      useLayoutStore.getState().setViewMode(command.mode);
      break;

    case 'toggle-view-mode': {
      const current = useLayoutStore.getState().viewMode;
      useLayoutStore.getState().setViewMode(current === 'tiles' ? 'kanban' : 'tiles');
      break;
    }

    case 'search-in-files': {
      const store = useLayoutStore.getState();
      // Ensure sidebar is open on the search tab
      if (store.sidebarCollapsed) {
        store.setActiveSidebarTab('search');
        store.toggleSidebar();
      } else if (store.activeSidebarTab !== 'search') {
        store.setActiveSidebarTab('search');
      }
      // The SearchPanel component listens for this command to focus its input
      break;
    }

    case 'run-shell-command': {
      const ls = useLayoutStore.getState();
      ls.setShowSettings(false);
      ls.setShowKeyboardShortcuts(false);
      if (ls.showCommandPalette) {
        ls.setShowCommandPalette(false);
      } else {
        ls.openQuickOpen('shell');
      }
      break;
    }

    case 'open-snippets': {
      const ls = useLayoutStore.getState();
      ls.setShowSettings(false);
      ls.setShowKeyboardShortcuts(false);
      if (ls.showCommandPalette) {
        ls.setShowCommandPalette(false);
      } else {
        ls.openQuickOpen('snippets');
      }
      break;
    }

    case 'split-terminal-horizontal': {
      const panel = useTerminalPanelStore.getState();
      if (panel.activeTabGroupId) panel.splitTabGroup(panel.activeTabGroupId, 'horizontal');
      break;
    }

    case 'split-terminal-vertical': {
      const panel = useTerminalPanelStore.getState();
      if (panel.activeTabGroupId) panel.splitTabGroup(panel.activeTabGroupId, 'vertical');
      break;
    }

    case 'close-terminal': {
      const panel = useTerminalPanelStore.getState();
      const entry = panel.getActiveTerminal();
      if (entry) {
        window.mcode.sessions.kill(entry.sessionId).catch(console.error);
        panel.removeTerminal(entry.sessionId);
      }
      break;
    }

    case 'cycle-terminal-tab':
      useTerminalPanelStore.getState().cycleTab(command.direction);
      break;

    case 'toggle-terminal-panel': {
      const panel = useTerminalPanelStore.getState();
      const panelEl = document.querySelector('[data-terminal-panel]');
      const focusedInPanel = panelEl?.contains(document.activeElement) ?? false;

      const focusPanelTerminal = (): void => {
        requestAnimationFrame(() => {
          const el = document.querySelector('[data-terminal-panel] .xterm-helper-textarea') as HTMLElement | null;
          if (el) {
            el.focus();
          } else {
            const container = document.querySelector('[data-terminal-panel]');
            if (container instanceof HTMLElement) container.focus();
          }
        });
      };

      if (panel.panelVisible && focusedInPanel) {
        // Panel visible + focused → hide panel, return focus to workspace
        panel.setPanelVisible(false);
        requestAnimationFrame(() => {
          const tile = document.querySelector('.mosaic-tile .xterm-helper-textarea') as HTMLElement | null;
          tile?.focus();
        });
      } else if (panel.panelVisible) {
        // Panel visible + not focused → focus it
        focusPanelTerminal();
      } else {
        // Panel hidden → show and focus
        panel.setPanelVisible(true);
        focusPanelTerminal();
      }
      break;
    }
  }
}
