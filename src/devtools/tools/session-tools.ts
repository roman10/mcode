import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';

export function registerSessionTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('session_list', {
    description: 'List all sessions with their status and metadata',
    annotations: { readOnlyHint: true },
  }, async () => {
    const sessions = ctx.sessionManager.list();
    return {
      content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }],
    };
  });

  server.registerTool('session_create', {
    description: 'Create a new Claude Code session',
    inputSchema: {
      cwd: z.string().describe('Working directory for the session'),
      label: z.string().optional().describe('Optional label for the session'),
      initialPrompt: z.string().optional().describe('Optional initial prompt for Claude'),
      permissionMode: z.string().optional().describe('Permission mode: plan, autoEdit, fullAuto'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ cwd, label, initialPrompt, permissionMode }) => {
    try {
      const session = ctx.sessionManager.create({
        cwd,
        label,
        initialPrompt,
        permissionMode,
      });
      // Notify renderer to add session to store (best-effort)
      try {
        if (!ctx.mainWindow.isDestroyed()) {
          ctx.mainWindow.webContents.send('session:created', session);
        }
      } catch {
        // Notification failure should not mask a successful creation
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(session, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to create session: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('session_kill', {
    description: 'Kill a session by ID',
    inputSchema: {
      sessionId: z.string().describe('The session ID to kill'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId }) => {
    const session = ctx.sessionManager.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }
    await ctx.sessionManager.kill(sessionId);
    return {
      content: [{ type: 'text', text: `Session ${sessionId} killed` }],
    };
  });

  server.registerTool('session_get_status', {
    description: 'Get session status and metadata',
    inputSchema: {
      sessionId: z.string().describe('The session ID'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ sessionId }) => {
    const session = ctx.sessionManager.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(session, null, 2) }],
    };
  });

  server.registerTool('session_info', {
    description: 'Get PTY-level metadata for a session (pid, cols, rows)',
    inputSchema: {
      sessionId: z.string().describe('The PTY session ID'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ sessionId }) => {
    const info = ctx.ptyManager.getInfo(sessionId);
    if (!info) {
      return {
        content: [{ type: 'text', text: `PTY ${sessionId} not found` }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(info) }],
    };
  });
}
