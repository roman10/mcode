import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import { queryRenderer } from '../ipc';

export function registerLayoutTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('layout_get_tree', {
    description: 'Get the current mosaic layout tree as JSON',
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const tree = await queryRenderer<unknown>(
        ctx.mainWindow,
        'layout-tree',
        {},
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get layout tree: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('layout_add_tile', {
    description: 'Add a tile for a session to the mosaic layout',
    inputSchema: {
      sessionId: z.string().describe('The session ID to add a tile for'),
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
    try {
      await queryRenderer<void>(ctx.mainWindow, 'layout-add-tile', {
        sessionId,
      });
      return {
        content: [
          { type: 'text', text: `Added tile for session ${sessionId}` },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to add tile: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('layout_remove_tile', {
    description: 'Remove a tile from the mosaic layout (session keeps running)',
    inputSchema: {
      sessionId: z.string().describe('The session ID whose tile to remove'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId }) => {
    try {
      await queryRenderer<void>(ctx.mainWindow, 'layout-remove-tile', {
        sessionId,
      });
      return {
        content: [
          {
            type: 'text',
            text: `Removed tile for session ${sessionId}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to remove tile: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('layout_get_tile_count', {
    description: 'Get the number of visible tiles in the mosaic layout',
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const count = await queryRenderer<number>(
        ctx.mainWindow,
        'layout-tile-count',
        {},
      );
      return {
        content: [{ type: 'text', text: String(count) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get tile count: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('layout_get_sidebar_width', {
    description: 'Get the current sidebar width in pixels',
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const width = await queryRenderer<number>(
        ctx.mainWindow,
        'layout-sidebar-width',
        {},
      );
      return {
        content: [{ type: 'text', text: String(width) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get sidebar width: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('layout_set_sidebar_width', {
    description: 'Set the sidebar width in pixels',
    inputSchema: {
      width: z
        .number()
        .int()
        .min(200)
        .max(500)
        .describe('Sidebar width in pixels (200-500)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ width }) => {
    try {
      await queryRenderer<void>(ctx.mainWindow, 'layout-set-sidebar-width', {
        width,
      });
      return {
        content: [{ type: 'text', text: String(width) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to set sidebar width: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('sidebar_get_sessions', {
    description: 'List sessions shown in the sidebar with their status',
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const sessions = await queryRenderer<unknown>(
        ctx.mainWindow,
        'sidebar-sessions',
        {},
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get sidebar sessions: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('sidebar_select_session', {
    description:
      'Select a session in the sidebar, or pass null to deselect',
    inputSchema: {
      sessionId: z
        .string()
        .nullable()
        .describe('The session ID to select, or null to deselect'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId }) => {
    try {
      await queryRenderer<void>(ctx.mainWindow, 'session-select', {
        sessionId,
      });
      return {
        content: [
          { type: 'text', text: `Selected: ${sessionId ?? 'none'}` },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to select session: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('sidebar_get_selected', {
    description: 'Get the currently selected session ID in the sidebar',
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const selectedId = await queryRenderer<string | null>(
        ctx.mainWindow,
        'session-get-selected',
        {},
      );
      return {
        content: [
          { type: 'text', text: JSON.stringify({ selectedSessionId: selectedId }) },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get selected session: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });
}
