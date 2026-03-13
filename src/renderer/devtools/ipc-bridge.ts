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

export function initDevtoolsBridge(): void {
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
    }

    window.mcode.devtools.sendResponse(requestId, result);
  });
}
