import { terminalRegistry } from './terminal-registry';

function readTerminalBuffer(sessionId: string, lines?: number): string {
  const term = terminalRegistry.get(sessionId);
  if (!term) return '';

  const buffer = term.buffer.active;
  const totalRows = buffer.length;
  const viewportRows = term.rows;

  // Default: read visible viewport. If lines specified, read that many from bottom.
  const count = lines ?? viewportRows;
  const startRow = Math.max(0, totalRows - count);

  const result: string[] = [];
  for (let i = startRow; i < totalRows; i++) {
    const line = buffer.getLine(i);
    if (line) {
      const text = line.translateToString(true);
      if (line.isWrapped && result.length > 0) {
        result[result.length - 1] += text;
      } else {
        result.push(text);
      }
    }
  }

  return result.join('\n');
}

let initialized = false;

export function initDevtoolsBridge(): void {
  if (initialized) return;
  initialized = true;

  window.mcode.devtools.onQuery(async (requestId, type, params) => {
    let result: unknown = null;

    switch (type) {
      case 'terminal-buffer': {
        const { sessionId, lines } = params as {
          sessionId: string;
          lines?: number;
        };
        result = readTerminalBuffer(sessionId, lines);
        break;
      }
      case 'console-logs': {
        const { getEntries } = await import('./console-capture');
        result = getEntries((params as { limit?: number }).limit);
        break;
      }
      case 'hmr-events': {
        const { getHmrEvents } = await import('./hmr-capture');
        result = getHmrEvents((params as { limit?: number }).limit);
        break;
      }
      case 'layout-tree': {
        const { useLayoutStore } = await import('../stores/layout-store');
        result = useLayoutStore.getState().mosaicTree;
        break;
      }
      case 'layout-add-tile': {
        const { sessionId } = params as { sessionId: string };
        const { useLayoutStore } = await import('../stores/layout-store');
        useLayoutStore.getState().addTile(sessionId);
        useLayoutStore.getState().persist();
        result = true;
        break;
      }
      case 'layout-remove-tile': {
        const { sessionId } = params as { sessionId: string };
        const { useLayoutStore } = await import('../stores/layout-store');
        useLayoutStore.getState().removeTile(sessionId);
        useLayoutStore.getState().persist();
        result = true;
        break;
      }
      case 'layout-remove-all-tiles': {
        const { useLayoutStore } = await import('../stores/layout-store');
        useLayoutStore.getState().removeAllTiles();
        useLayoutStore.getState().persist();
        result = true;
        break;
      }
      case 'layout-tile-count': {
        const { useLayoutStore } = await import('../stores/layout-store');
        const { getLeaves } = await import('react-mosaic-component');
        const tree = useLayoutStore.getState().mosaicTree;
        result = tree ? getLeaves(tree).length : 0;
        break;
      }
      case 'layout-sidebar-width': {
        const { useLayoutStore } = await import('../stores/layout-store');
        result = useLayoutStore.getState().sidebarWidth;
        break;
      }
      case 'layout-set-sidebar-width': {
        const { width } = params as { width: number };
        const { useLayoutStore } = await import('../stores/layout-store');
        useLayoutStore.getState().setSidebarWidth(width);
        useLayoutStore.getState().persist();
        result = true;
        break;
      }
      case 'sidebar-sessions': {
        const { useSessionStore } = await import('../stores/session-store');
        const { getOrderedVisibleSessions } = await import('../utils/session-ordering');
        result = getOrderedVisibleSessions(useSessionStore.getState().sessions);
        break;
      }
      case 'session-select': {
        const { sessionId } = params as { sessionId: string | null };
        const { useSessionStore } = await import('../stores/session-store');
        useSessionStore.getState().selectSession(sessionId);
        result = true;
        break;
      }
      case 'session-get-selected': {
        const { useSessionStore } = await import('../stores/session-store');
        result = useSessionStore.getState().selectedSessionId;
        break;
      }
      case 'layout-sidebar-collapsed': {
        const { useLayoutStore } = await import('../stores/layout-store');
        result = useLayoutStore.getState().sidebarCollapsed;
        break;
      }
      case 'layout-set-sidebar-collapsed': {
        const { collapsed } = params as { collapsed: boolean };
        const { useLayoutStore } = await import('../stores/layout-store');
        const state = useLayoutStore.getState();
        if (state.sidebarCollapsed !== collapsed) {
          state.toggleSidebar();
        }
        result = true;
        break;
      }
      case 'layout-toggle-keyboard-shortcuts': {
        const { useLayoutStore } = await import('../stores/layout-store');
        const current = useLayoutStore.getState().showKeyboardShortcuts;
        useLayoutStore.getState().setShowKeyboardShortcuts(!current);
        result = !current;
        break;
      }
      case 'layout-toggle-command-palette': {
        const { useLayoutStore } = await import('../stores/layout-store');
        const current = useLayoutStore.getState().showCommandPalette;
        useLayoutStore.getState().setShowCommandPalette(!current);
        result = !current;
        break;
      }
      case 'layout-switch-sidebar-tab': {
        const { tab } = params as { tab: string };
        const { useLayoutStore } = await import('../stores/layout-store');
        const store = useLayoutStore.getState();
        const targetTab = tab as import('@shared/types').SidebarTab;
        if (store.sidebarCollapsed) {
          store.setActiveSidebarTab(targetTab);
          store.toggleSidebar();
        } else if (store.activeSidebarTab === targetTab) {
          store.toggleSidebar();
        } else {
          store.setActiveSidebarTab(targetTab);
        }
        result = { tab: useLayoutStore.getState().activeSidebarTab };
        break;
      }
      case 'layout-get-sidebar-tab': {
        const { useLayoutStore } = await import('../stores/layout-store');
        result = { tab: useLayoutStore.getState().activeSidebarTab };
        break;
      }
      case 'layout-get-view-mode': {
        const { useLayoutStore } = await import('../stores/layout-store');
        result = { viewMode: useLayoutStore.getState().viewMode };
        break;
      }
      case 'layout-set-view-mode': {
        const { mode } = params as { mode: string };
        const { useLayoutStore } = await import('../stores/layout-store');
        useLayoutStore.getState().setViewMode(mode as import('@shared/types').ViewMode);
        result = { viewMode: mode };
        break;
      }
      case 'kanban-get-columns': {
        const { useSessionStore } = await import('../stores/session-store');
        const { useLayoutStore } = await import('../stores/layout-store');
        const { groupSessionsByColumn } = await import('../components/Kanban/kanban-utils');
        const sessions = useSessionStore.getState().sessions;
        const grouped = groupSessionsByColumn(sessions);
        const layoutState = useLayoutStore.getState();
        result = {
          expandedSessionId: layoutState.kanbanExpandedSessionId,
          openFiles: layoutState.kanbanOpenFiles,
          activeFile: layoutState.kanbanActiveFile,
          columns: Object.fromEntries(
            Object.entries(grouped).map(([col, colSessions]) => [
              col,
              colSessions.map((s) => ({ sessionId: s.sessionId, label: s.label, status: s.status, attentionLevel: s.attentionLevel })),
            ]),
          ),
        };
        break;
      }
      case 'kanban-expand-session': {
        const { sessionId } = params as { sessionId: string };
        const { useLayoutStore } = await import('../stores/layout-store');
        useLayoutStore.getState().expandKanbanSession(sessionId);
        result = { expanded: sessionId };
        break;
      }
      case 'kanban-collapse': {
        const { useLayoutStore } = await import('../stores/layout-store');
        useLayoutStore.getState().clearKanbanExpand();
        result = { collapsed: true };
        break;
      }
      case 'file-open-viewer': {
        const { absolutePath } = params as { absolutePath: string };
        const { useLayoutStore } = await import('../stores/layout-store');
        useLayoutStore.getState().addFileViewer(absolutePath);
        useLayoutStore.getState().persist();
        result = { ok: true };
        break;
      }
      case 'diff-open-viewer': {
        const { absolutePath } = params as { absolutePath: string };
        const { useLayoutStore } = await import('../stores/layout-store');
        useLayoutStore.getState().addDiffViewer(absolutePath);
        useLayoutStore.getState().persist();
        result = { ok: true };
        break;
      }
      case 'quick-open-toggle': {
        const { mode } = params as { mode: 'files' | 'commands' };
        const { useLayoutStore } = await import('../stores/layout-store');
        const store = useLayoutStore.getState();
        if (store.showCommandPalette) {
          store.setShowCommandPalette(false);
          result = false;
        } else {
          store.openQuickOpen(mode);
          result = true;
        }
        break;
      }
      case 'terminal-action': {
        const { sessionId, action } = params as { sessionId: string; action: string };
        const term = terminalRegistry.get(sessionId);
        if (!term) {
          result = { error: 'Session not found' };
          break;
        }
        switch (action) {
          case 'copy':
            result = { text: term.getSelection() || '' };
            break;
          case 'selectAll':
            term.selectAll();
            result = { ok: true };
            break;
          case 'clear':
            term.clear();
            result = { ok: true };
            break;
          default:
            result = { error: `Unknown action: ${action}` };
        }
        break;
      }
    }

    window.mcode.devtools.sendResponse(requestId, result);
  });
}
