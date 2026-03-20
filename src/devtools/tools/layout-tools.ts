import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import { queryRenderer } from '../ipc';
import type { SessionAttentionLevel, SessionInfo, SessionStatus } from '../../shared/types';

const attentionOrder: Record<SessionAttentionLevel, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

const statusOrder: Record<SessionStatus, number> = {
  waiting: 0,
  active: 1,
  starting: 2,
  idle: 3,
  ended: 4,
};

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

  server.registerTool('layout_remove_all_tiles', {
    description: 'Remove all tiles from the mosaic layout (sessions keep running)',
    annotations: { readOnlyHint: false },
  }, async () => {
    try {
      await queryRenderer<void>(ctx.mainWindow, 'layout-remove-all-tiles', {});
      return {
        content: [{ type: 'text', text: 'Removed all tiles' }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to remove all tiles: ${err instanceof Error ? err.message : String(err)}`,
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
    description: 'List sessions shown in the sidebar with their status (excludes ephemeral sessions)',
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const sessions = ctx.sessionManager.list().sort(
        (a: SessionInfo, b: SessionInfo) =>
          (attentionOrder[a.attentionLevel] ?? 9) - (attentionOrder[b.attentionLevel] ?? 9) ||
          (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) ||
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
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
      if (sessionId !== null) {
        const session = ctx.sessionManager.get(sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: `Session ${sessionId} not found` }],
            isError: true,
          };
        }
        ctx.sessionManager.clearAttention(sessionId);
      }

      try {
        await queryRenderer<void>(ctx.mainWindow, 'session-select', {
          sessionId,
        });
      } catch {
        // Renderer selection is best-effort for MCP tests; the source of truth lives in main.
      }

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

  server.registerTool('layout_get_sidebar_collapsed', {
    description: 'Get whether the sidebar is currently collapsed',
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const collapsed = await queryRenderer<boolean>(
        ctx.mainWindow,
        'layout-sidebar-collapsed',
        {},
      );
      return {
        content: [{ type: 'text', text: JSON.stringify({ collapsed }) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get sidebar collapsed state: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('layout_set_sidebar_collapsed', {
    description: 'Set the sidebar collapsed state',
    inputSchema: {
      collapsed: z.boolean().describe('Whether the sidebar should be collapsed'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ collapsed }) => {
    try {
      await queryRenderer<void>(ctx.mainWindow, 'layout-set-sidebar-collapsed', {
        collapsed,
      });
      return {
        content: [{ type: 'text', text: `Sidebar collapsed: ${collapsed}` }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to set sidebar collapsed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('layout_toggle_keyboard_shortcuts', {
    description: 'Toggle the keyboard shortcuts dialog (show if hidden, hide if shown)',
    annotations: { readOnlyHint: false },
  }, async () => {
    try {
      const visible = await queryRenderer<boolean>(
        ctx.mainWindow,
        'layout-toggle-keyboard-shortcuts',
        {},
      );
      return {
        content: [
          { type: 'text', text: visible ? 'Keyboard shortcuts dialog shown' : 'Keyboard shortcuts dialog hidden' },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to toggle keyboard shortcuts: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('layout_toggle_command_palette', {
    description: 'Toggle the command palette (show if hidden, hide if shown)',
    annotations: { readOnlyHint: false },
  }, async () => {
    try {
      const visible = await queryRenderer<boolean>(
        ctx.mainWindow,
        'layout-toggle-command-palette',
        {},
      );
      return {
        content: [
          { type: 'text', text: visible ? 'Command palette shown' : 'Command palette hidden' },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to toggle command palette: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('sidebar_switch_tab', {
    description: 'Switch the sidebar to a specific tab (sessions, commits, tokens, activity)',
    annotations: { readOnlyHint: false },
    inputSchema: {
      tab: z.enum(['sessions', 'commits', 'tokens', 'activity']).describe('The sidebar tab to switch to'),
    },
  }, async ({ tab }) => {
    try {
      const result = await queryRenderer<{ tab: string }>(
        ctx.mainWindow,
        'layout-switch-sidebar-tab',
        { tab },
      );
      return {
        content: [
          { type: 'text', text: `Sidebar switched to ${result.tab} tab` },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to switch sidebar tab: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  // --- View Mode (Tiles / Kanban) ---

  server.registerTool('layout_get_view_mode', {
    description: 'Get the current view mode (tiles or kanban)',
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const result = await queryRenderer<{ viewMode: string }>(
        ctx.mainWindow,
        'layout-get-view-mode',
        {},
      );
      return {
        content: [{ type: 'text', text: `View mode: ${result.viewMode}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  server.registerTool('layout_set_view_mode', {
    description: 'Switch the layout view mode to tiles or kanban',
    annotations: { readOnlyHint: false },
    inputSchema: {
      mode: z.enum(['tiles', 'kanban']).describe('The view mode to switch to'),
    },
  }, async ({ mode }) => {
    try {
      const result = await queryRenderer<{ viewMode: string }>(
        ctx.mainWindow,
        'layout-set-view-mode',
        { mode },
      );
      return {
        content: [{ type: 'text', text: `View mode set to: ${result.viewMode}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  server.registerTool('kanban_get_columns', {
    description: 'Get the kanban board state: expandedSessionId and columns (needs-attention, working, ready, completed) with their sessions',
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const result = await queryRenderer<{
        expandedSessionId: string | null;
        columns: Record<string, Array<{ sessionId: string; label: string; status: string; attentionLevel: string }>>;
      }>(
        ctx.mainWindow,
        'kanban-get-columns',
        {},
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  server.registerTool('kanban_expand_session', {
    description: 'Expand a session to full terminal view in kanban mode',
    annotations: { readOnlyHint: false },
    inputSchema: {
      sessionId: z.string().describe('The session ID to expand'),
    },
  }, async ({ sessionId }) => {
    try {
      await queryRenderer(ctx.mainWindow, 'kanban-expand-session', { sessionId });
      return {
        content: [{ type: 'text', text: `Expanded session ${sessionId} in kanban view` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  server.registerTool('kanban_collapse', {
    description: 'Collapse expanded terminal back to kanban board overview',
    annotations: { readOnlyHint: false },
  }, async () => {
    try {
      await queryRenderer(ctx.mainWindow, 'kanban-collapse', {});
      return {
        content: [{ type: 'text', text: 'Kanban view collapsed to board overview' }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  // --- Sidebar ---

  server.registerTool('sidebar_get_active_tab', {
    description: 'Get the currently active sidebar tab',
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const result = await queryRenderer<{ tab: string }>(
        ctx.mainWindow,
        'layout-get-sidebar-tab',
        {},
      );
      return {
        content: [
          { type: 'text', text: `Active sidebar tab: ${result.tab}` },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get sidebar tab: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });
}
