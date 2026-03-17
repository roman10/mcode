import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import { PERMISSION_MODES } from '../../shared/constants';

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
      permissionMode: z.enum(PERMISSION_MODES).optional().describe('Permission mode for the Claude session'),
      command: z.string().optional().describe('Command to spawn (default: "claude")'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ cwd, label, initialPrompt, permissionMode, command }) => {
    try {
      const session = ctx.sessionManager.create({
        cwd,
        label,
        initialPrompt,
        permissionMode,
        command,
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

  server.registerTool('session_wait_for_status', {
    description: 'Wait until a session reaches the specified status. Polls every 250ms.',
    inputSchema: {
      sessionId: z.string().describe('The session ID'),
      status: z.enum(['starting', 'active', 'idle', 'waiting', 'ended']).describe('Target status to wait for'),
      timeout_ms: z.number().int().positive().optional().describe('Timeout in milliseconds (default: 15000)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ sessionId, status, timeout_ms }) => {
    const timeout = timeout_ms ?? 15000;
    const pollInterval = 250;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const session = ctx.sessionManager.get(sessionId);
      if (!session) {
        return {
          content: [{ type: 'text', text: `Session ${sessionId} not found` }],
          isError: true,
        };
      }
      if (session.status === status) {
        return {
          content: [{ type: 'text', text: JSON.stringify(session, null, 2) }],
        };
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    // Final check
    const session = ctx.sessionManager.get(sessionId);
    if (session?.status === status) {
      return {
        content: [{ type: 'text', text: JSON.stringify(session, null, 2) }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: `Timeout after ${timeout}ms waiting for status "${status}". Current status: ${session?.status ?? 'not found'}`,
      }],
      isError: true,
    };
  });

  server.registerTool('session_set_label', {
    description: 'Set the label for a session',
    inputSchema: {
      sessionId: z.string().describe('The session ID'),
      label: z.string().describe('The new label'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId, label }) => {
    const session = ctx.sessionManager.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }
    ctx.sessionManager.setLabel(sessionId, label);
    const updated = ctx.sessionManager.get(sessionId);
    return {
      content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
    };
  });
}
