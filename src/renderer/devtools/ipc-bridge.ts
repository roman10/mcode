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
      result.push(line.translateToString(true));
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
        const sessions = useSessionStore.getState().sessions;
        result = Object.values(sessions);
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
    }

    window.mcode.devtools.sendResponse(requestId, result);
  });
}
