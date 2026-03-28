import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import { queryRenderer } from '../ipc';
import { EFFORT_LEVELS, PERMISSION_MODES } from '../../shared/constants';

export function registerSessionTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('session_list', {
    description: 'List all sessions with their status and metadata.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const sessions = ctx.sessionManager.list();
    return {
      content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }],
    };
  });

  server.registerTool('session_create', {
    description: 'Create a new Claude Code session, Codex CLI session, Gemini CLI session, or plain terminal',
    inputSchema: {
      cwd: z.string().describe('Working directory for the session'),
      label: z.string().optional().describe('Optional label for the session'),
      initialPrompt: z.string().optional().describe('Optional initial prompt for Claude, Codex, or Gemini (ignored for terminal sessions)'),
      model: z.string().optional().describe('Explicit model for Gemini sessions only (ignored for Claude, Codex, and terminal sessions)'),
      permissionMode: z.enum(PERMISSION_MODES).optional().describe('Permission mode for Claude sessions only (ignored for Codex, Gemini, and terminal sessions)'),
      effort: z.enum(EFFORT_LEVELS).optional().describe('Effort level for Claude sessions only (ignored for Codex, Gemini, and terminal sessions)'),
      enableAutoMode: z.boolean().optional().describe('Pass --enable-auto-mode for Claude sessions only. Ignored for Codex, Gemini, and terminal sessions.'),
      allowBypassPermissions: z.boolean().optional().describe('Pass --allow-dangerously-skip-permissions for Claude sessions only. Ignored for Codex, Gemini, and terminal sessions.'),
      command: z.string().optional().describe('Command to spawn (defaults to the CLI for the selected session type)'),
      args: z.array(z.string()).optional().describe('Arguments for the command (e.g. ["-c", "git push"] for terminal sessions)'),
      sessionType: z.enum(['claude', 'codex', 'gemini', 'terminal']).optional().describe('Session type: "claude" for Claude Code, "codex" for Codex CLI, "gemini" for Gemini CLI, "terminal" for plain shell (default: "claude")'),
      worktree: z.string().optional().describe('Run session in an isolated git worktree for Claude sessions. Ignored for Codex, Gemini, and terminal sessions.'),
      accountId: z.string().optional().describe('Account profile ID to run this session under'),
      autoClose: z.boolean().optional().describe('If true, automatically kill the session when its task queue empties'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ cwd, label, initialPrompt, model, permissionMode, effort, enableAutoMode, allowBypassPermissions, command, args, sessionType, worktree, accountId, autoClose }) => {
    try {
      const session = ctx.sessionManager.create({
        cwd,
        label,
        initialPrompt,
        model,
        permissionMode,
        effort,
        enableAutoMode,
        allowBypassPermissions,
        command,
        args,
        sessionType,
        worktree,
        accountId,
        autoClose,
      });
      // Sync renderer state for MCP-created sessions so integration tests
      // do not depend on the normal IPC event subscription timing.
      try {
        if (!ctx.mainWindow.isDestroyed()) {
          await queryRenderer<void>(ctx.mainWindow, 'session-created', { session });
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
      content: [{
        type: 'text', text: ids.length === 0
          ? 'No ended sessions to delete'
          : `Deleted ${ids.length} session(s): ${ids.join(', ')}`
      }],
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
      content: [{
        type: 'text', text: deleted.length === 0
          ? 'No valid ended sessions to delete from the provided IDs'
          : `Deleted ${deleted.length} session(s): ${deleted.join(', ')}`
      }],
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

  server.registerTool('session_resume', {
    description: 'Resume an ended session in place',
    inputSchema: {
      sessionId: z.string().describe('The session ID'),
      accountId: z.string().optional().describe('Optional account override (Claude only)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId, accountId }) => {
    try {
      const session = ctx.sessionManager.resume(sessionId, accountId);
      return {
        content: [{ type: 'text', text: JSON.stringify(session, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
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

  server.registerTool('session_set_auto_label', {
    description: 'Attempt to auto-update the label for a session. No-op if the label was set by the user.',
    inputSchema: {
      sessionId: z.string().describe('The session ID'),
      label: z.string().describe('The new label to apply if not user-set'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId, label }) => {
    ctx.sessionManager.setAutoLabel(sessionId, label);
    const updated = ctx.sessionManager.get(sessionId);
    return {
      content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
    };
  });

  server.registerTool('session_set_model', {
    description: 'Set the model for a session (for testing model display)',
    inputSchema: {
      sessionId: z.string().describe('The session ID'),
      model: z.string().describe('Normalized model version, e.g. "opus-4.6", "sonnet-4.5"'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId, model }) => {
    const session = ctx.sessionManager.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }
    ctx.sessionManager.setModel(sessionId, model);
    const updated = ctx.sessionManager.get(sessionId);
    return {
      content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
    };
  });

  server.registerTool('session_set_codex_thread_id', {
    description: 'Set the Codex thread ID for a session (useful for testing or manual recovery)',
    inputSchema: {
      sessionId: z.string().describe('The session ID'),
      codexThreadId: z.string().describe('Codex thread ID'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId, codexThreadId }) => {
    try {
      ctx.sessionManager.setCodexThreadId(sessionId, codexThreadId);
      const updated = ctx.sessionManager.get(sessionId);
      return {
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  });

  server.registerTool('session_set_gemini_session_id', {
    description: 'Set the Gemini session ID for a session (useful for testing or manual recovery)',
    inputSchema: {
      sessionId: z.string().describe('The session ID'),
      geminiSessionId: z.string().describe('Gemini session ID'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId, geminiSessionId }) => {
    try {
      ctx.sessionManager.setGeminiSessionId(sessionId, geminiSessionId);
      const updated = ctx.sessionManager.get(sessionId);
      return {
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  });

  server.registerTool('session_set_auto_close', {
    description: 'Enable or disable auto-close for a session. When enabled, the session is automatically killed when its task queue empties.',
    inputSchema: {
      sessionId: z.string().describe('The session ID'),
      autoClose: z.boolean().describe('Set to true to enable auto-close, false to disable'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId, autoClose }) => {
    const session = ctx.sessionManager.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }
    ctx.sessionManager.setAutoClose(sessionId, autoClose);
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
