import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';

export function registerPromptHistoryTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('prompt_history_recent', {
    description: 'List recent prompt history entries, with pinned prompts first.',
    inputSchema: {
      limit: z.number().int().positive().optional().describe('Max results (default: 50)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => {
    const entries = ctx.inputTracker.recentPrompts(limit);
    return {
      content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }],
    };
  });

  server.registerTool('prompt_history_search', {
    description: 'Search prompt history by text query.',
    inputSchema: {
      query: z.string().describe('Search query'),
      limit: z.number().int().positive().optional().describe('Max results (default: 50)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query, limit }) => {
    const entries = ctx.inputTracker.searchPrompts(query, limit);
    return {
      content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }],
    };
  });

  server.registerTool('prompt_history_toggle_pin', {
    description: 'Toggle the pinned state of a prompt history entry.',
    inputSchema: {
      id: z.number().int().describe('The prompt history entry ID'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ id }) => {
    ctx.inputTracker.togglePin(id);
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, id }) }],
    };
  });

  server.registerTool('prompt_history_list_pinned', {
    description: 'List only pinned prompt history entries.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const all = ctx.inputTracker.recentPrompts(500);
    const pinned = all.filter((e) => e.isPinned);
    return {
      content: [{ type: 'text', text: JSON.stringify(pinned, null, 2) }],
    };
  });
}
