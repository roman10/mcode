import type { AppCommand } from '../../shared/types';
import { useLayoutStore } from '../stores/layout-store';
import { useSessionStore } from '../stores/session-store';
import { getOrderedVisibleSessions } from './session-ordering';
import { createTerminalSession } from './session-actions';

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
      const ordered = getOrderedVisibleSessions(useSessionStore.getState().sessions);
      const target = ordered[command.index];
      if (!target) break;
      useLayoutStore.getState().addTile(target.sessionId);
      useLayoutStore.getState().persist();
      useSessionStore.getState().selectSession(target.sessionId);
      break;
    }

    case 'focus-next-session':
    case 'focus-prev-session': {
      const sessions = useSessionStore.getState().sessions;
      const selectedId = useSessionStore.getState().selectedSessionId;
      const ordered = getOrderedVisibleSessions(sessions);
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

    case 'toggle-dashboard':
      useLayoutStore.getState().toggleDashboard();
      break;

    case 'toggle-commit-stats':
      useLayoutStore.getState().toggleCommitStats();
      break;

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
  }
}
