import { z } from 'zod';
import { app } from 'electron';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import type { ConsoleEntry, HmrEvent } from '../types';
import { queryRenderer } from '../ipc';

export function registerAppTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('app_get_sleep_blocker_status', {
    description:
      'Get sleep prevention status: whether the feature is enabled and whether the system sleep blocker is currently active',
    annotations: { readOnlyHint: true },
  }, async () => {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              enabled: ctx.sleepBlocker.isEnabled(),
              blocking: ctx.sleepBlocker.isBlocking(),
            },
            null,
            2,
          ),
        },
      ],
    };
  });

  server.registerTool('app_set_prevent_sleep', {
    description:
      'Enable or disable sleep prevention. When enabled, the app prevents system sleep while sessions are active.',
    inputSchema: {
      enabled: z.boolean().describe('Whether to enable sleep prevention'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ enabled }) => {
    ctx.sleepBlocker.setEnabled(enabled);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              enabled: ctx.sleepBlocker.isEnabled(),
              blocking: ctx.sleepBlocker.isBlocking(),
            },
            null,
            2,
          ),
        },
      ],
    };
  });

  server.registerTool('app_get_version', {
    description: 'Get the application version',
    annotations: { readOnlyHint: true },
  }, async () => {
    return {
      content: [{ type: 'text', text: app.getVersion() }],
    };
  });

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
