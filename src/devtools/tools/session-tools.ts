import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import { EFFORT_LEVELS, PERMISSION_MODES } from '../../shared/constants';

export function registerSessionTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('session_list', {
    description: 'List all sessions with their status and metadata. Ephemeral sessions are excluded by default.',
    inputSchema: {
      include_ephemeral: z.boolean().optional().describe('If true, include ephemeral (test/verification) sessions in the list'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ include_ephemeral }) => {
    const sessions = ctx.sessionManager.list({ includeEphemeral: include_ephemeral });
    return {
      content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }],
    };
  });

  server.registerTool('session_create', {
    description: 'Create a new Claude Code session or plain terminal',
    inputSchema: {
      cwd: z.string().describe('Working directory for the session'),
      label: z.string().optional().describe('Optional label for the session'),
      initialPrompt: z.string().optional().describe('Optional initial prompt for Claude (ignored for terminal sessions)'),
      permissionMode: z.enum(PERMISSION_MODES).optional().describe('Permission mode for the Claude session (ignored for terminal sessions)'),
      effort: z.enum(EFFORT_LEVELS).optional().describe('Effort level for the Claude session (ignored for terminal sessions)'),
      command: z.string().optional().describe('Command to spawn (default: "claude")'),
      args: z.array(z.string()).optional().describe('Arguments for the command (e.g. ["-c", "git push"] for terminal sessions)'),
      sessionType: z.enum(['claude', 'terminal']).optional().describe('Session type: "claude" for Claude Code, "terminal" for plain shell (default: "claude")'),
      ephemeral: z.boolean().optional().describe('If true, session is hidden from sidebar and auto-deleted when ended. Use for test/verification sessions.'),
      worktree: z.string().optional().describe('Run session in an isolated git worktree. Pass a name to create a named worktree, or empty string to auto-generate. Ignored for terminal sessions.'),
      accountId: z.string().optional().describe('Account profile ID to run this session under'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ cwd, label, initialPrompt, permissionMode, effort, command, args, sessionType, ephemeral, worktree, accountId }) => {
    try {
      const session = ctx.sessionManager.create({
        cwd,
        label,
        initialPrompt,
        permissionMode,
        effort,
        command,
        args,
        sessionType,
        ephemeral,
        worktree,
        accountId,
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

  server.registerTool('session_delete', {
    description: 'Delete an ended session from mcode (removes DB records, not Claude Code files). Session must be ended first.',
    inputSchema: {
      sessionId: z.string().describe('The session ID to delete'),
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
    if (session.status !== 'ended') {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} is not ended (status: ${session.status}). Kill it first.` }],
        isError: true,
      };
    }
    ctx.sessionManager.delete(sessionId);
    return {
      content: [{ type: 'text', text: `Session ${sessionId} deleted` }],
    };
  });

  server.registerTool('session_delete_all_ended', {
    description: 'Delete all ended sessions from mcode. Returns the list of deleted session IDs.',
    inputSchema: {},
    annotations: { readOnlyHint: false },
  }, async () => {
    const ids = ctx.sessionManager.deleteAllEnded();
    return {
      content: [{ type: 'text', text: ids.length === 0
        ? 'No ended sessions to delete'
        : `Deleted ${ids.length} session(s): ${ids.join(', ')}` }],
    };
  });

  server.registerTool('session_delete_batch', {
    description: 'Delete a specific set of ended sessions by their IDs. Returns the list of actually deleted session IDs.',
    inputSchema: {
      sessionIds: z.array(z.string()).describe('Array of session IDs to delete (must be ended)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionIds }) => {
    const deleted = ctx.sessionManager.deleteBatch(sessionIds);
    return {
      content: [{ type: 'text', text: deleted.length === 0
        ? 'No valid ended sessions to delete from the provided IDs'
        : `Deleted ${deleted.length} session(s): ${deleted.join(', ')}` }],
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

  server.registerTool('account_list', {
    description: 'List all account profiles',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const accounts = ctx.accountManager.list();
    return {
      content: [{ type: 'text', text: JSON.stringify(accounts, null, 2) }],
    };
  });
}
