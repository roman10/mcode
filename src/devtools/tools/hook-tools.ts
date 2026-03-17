import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import { KNOWN_HOOK_EVENTS } from '../../shared/constants';
import type { HookEvent, SessionAttentionLevel } from '../../shared/types';

export function registerHookTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('app_get_hook_runtime', {
    description: 'Get the current hook runtime state (initializing, ready, or degraded)',
    annotations: { readOnlyHint: true },
  }, async () => {
    const info = ctx.getHookRuntimeInfo();
    return {
      content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
    };
  });

  server.registerTool('app_get_attention_summary', {
    description: 'Get per-level attention counts and the current dock badge string',
    annotations: { readOnlyHint: true },
  }, async () => {
    const sessions = ctx.sessionManager.list();
    const counts: Record<SessionAttentionLevel, number> = {
      high: 0,
      medium: 0,
      low: 0,
      none: 0,
    };
    for (const s of sessions) {
      counts[s.attentionLevel]++;
    }
    const dockBadge = counts.high > 0 ? String(counts.high) : '';
    return {
      content: [{ type: 'text', text: JSON.stringify({ ...counts, dockBadge }, null, 2) }],
    };
  });

  server.registerTool('hook_inject_event', {
    description:
      'Inject a synthetic hook event into the same processing path as the HTTP hook server. For testing and agent-driven verification.',
    inputSchema: {
      sessionId: z.string().describe('The mcode session ID'),
      hookEventName: z
        .enum(KNOWN_HOOK_EVENTS)
        .describe('The hook event name'),
      toolName: z.string().optional().describe('Tool name (for tool-related events)'),
      toolInput: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Tool input (for tool-related events)'),
      claudeSessionId: z
        .string()
        .optional()
        .describe('Claude session ID to associate'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId, hookEventName, toolName, toolInput, claudeSessionId }) => {
    // Verify session exists
    const session = ctx.sessionManager.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }

    const event: HookEvent = {
      sessionId,
      claudeSessionId: claudeSessionId ?? null,
      hookEventName,
      toolName: toolName ?? null,
      toolInput: toolInput ?? null,
      createdAt: new Date().toISOString(),
      payload: {
        hook_event_name: hookEventName,
        tool_name: toolName,
        tool_input: toolInput,
        session_id: claudeSessionId,
      },
    };

    ctx.sessionManager.handleHookEvent(sessionId, event);

    // Return updated session
    const updated = ctx.sessionManager.get(sessionId);
    return {
      content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
    };
  });

  server.registerTool('hook_list_recent', {
    description: 'List recent hook events for a session',
    inputSchema: {
      sessionId: z.string().describe('The session ID'),
      limit: z.number().int().positive().optional().describe('Max events to return (default: 50)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ sessionId, limit }) => {
    const events = ctx.sessionManager.getRecentEvents(sessionId, limit ?? 50);
    return {
      content: [{ type: 'text', text: JSON.stringify(events, null, 2) }],
    };
  });

  server.registerTool('session_wait_for_attention', {
    description: 'Wait until a session reaches the specified attention level. Polls every 250ms.',
    inputSchema: {
      sessionId: z.string().describe('The session ID'),
      attentionLevel: z.enum(['none', 'low', 'medium', 'high']).describe('Target attention level'),
      timeout_ms: z.number().int().positive().optional().describe('Timeout in milliseconds (default: 15000)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ sessionId, attentionLevel, timeout_ms }) => {
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
      if (session.attentionLevel === attentionLevel) {
        return {
          content: [{ type: 'text', text: JSON.stringify(session, null, 2) }],
        };
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    const session = ctx.sessionManager.get(sessionId);
    if (session?.attentionLevel === attentionLevel) {
      return {
        content: [{ type: 'text', text: JSON.stringify(session, null, 2) }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: `Timeout after ${timeout}ms waiting for attention "${attentionLevel}". Current: ${session?.attentionLevel ?? 'not found'}`,
      }],
      isError: true,
    };
  });

  server.registerTool('session_clear_attention', {
    description: 'Clear attention for a single session',
    inputSchema: {
      sessionId: z.string().describe('The session ID'),
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
    ctx.sessionManager.clearAttention(sessionId);
    const updated = ctx.sessionManager.get(sessionId);
    return {
      content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
    };
  });

  server.registerTool('session_clear_all_attention', {
    description: 'Clear attention for all sessions',
    annotations: { readOnlyHint: false },
  }, async () => {
    ctx.sessionManager.clearAllAttention();
    return {
      content: [{ type: 'text', text: 'All attention cleared' }],
    };
  });
}
