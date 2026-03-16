import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import type { ConsoleEntry, HmrEvent } from '../types';
import { queryRenderer } from '../ipc';

export function registerAppTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('app_get_console_logs', {
    description: 'Get captured console log entries from the renderer process',
    inputSchema: {
      level: z
        .enum(['log', 'warn', 'error', 'info'])
        .optional()
        .describe('Filter by log level'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Max number of entries to return (most recent first)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ level, limit }) => {
    try {
      let entries = await queryRenderer<ConsoleEntry[]>(
        ctx.mainWindow,
        'console-logs',
        { limit: limit ?? 0 },
      );
      if (level) {
        entries = entries.filter((e) => e.level === level);
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get console logs: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('app_get_hmr_events', {
    description: 'Get captured HMR (Hot Module Replacement) events from the renderer',
    inputSchema: {
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Max number of events to return (most recent first)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => {
    try {
      const events = await queryRenderer<HmrEvent[]>(
        ctx.mainWindow,
        'hmr-events',
        { limit: limit ?? 0 },
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(events, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get HMR events: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });
}
