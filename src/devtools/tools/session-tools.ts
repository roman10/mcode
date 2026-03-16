import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';

export function registerSessionTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('session_list', {
    description: 'List all active PTY session IDs',
    annotations: { readOnlyHint: true },
  }, async () => {
    const ids = ctx.ptyManager.list();
    return {
      content: [{ type: 'text', text: JSON.stringify(ids) }],
    };
  });

  server.registerTool('session_info', {
    description: 'Get metadata for a PTY session (id, pid, cols, rows)',
    inputSchema: { sessionId: z.string().describe('The PTY session ID') },
    annotations: { readOnlyHint: true },
  }, async ({ sessionId }) => {
    const info = ctx.ptyManager.getInfo(sessionId);
    if (!info) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(info) }],
    };
  });
}
