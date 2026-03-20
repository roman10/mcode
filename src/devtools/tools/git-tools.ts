import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import { queryRenderer } from '../ipc';

export function registerGitTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('git_get_status', {
    description:
      'Get git status (uncommitted changes) for a specific working directory. Returns a list of changed files with their status (modified, added, deleted, renamed, untracked).',
    inputSchema: {
      cwd: z.string().describe('Working directory to check git status for'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ cwd }) => {
    const status = await ctx.gitChangesService.getStatus(cwd);
    return {
      content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
    };
  });

  server.registerTool('git_get_all_statuses', {
    description:
      'Get git status across all active session repos. Returns one status result per unique repo root, only including repos with changes.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const statuses = await ctx.gitChangesService.getAllStatuses();
    return {
      content: [{ type: 'text', text: JSON.stringify(statuses, null, 2) }],
    };
  });

  server.registerTool('git_get_diff_content', {
    description:
      'Get diff content (original and modified text) for a specific file. Returns the HEAD version and the current working tree version for comparison.',
    inputSchema: {
      cwd: z.string().describe('Working directory (or any directory within the git repo)'),
      filePath: z.string().describe('Absolute path to the file'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ cwd, filePath }) => {
    const diff = await ctx.gitChangesService.getDiffContent(cwd, filePath);
    if (diff.binary) {
      return {
        content: [{ type: 'text', text: 'Binary file — diff not available' }],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(diff, null, 2) }],
    };
  });

  server.registerTool('git_open_diff_viewer', {
    description:
      'Open a diff viewer tile in the mosaic layout for the specified file, showing uncommitted changes.',
    inputSchema: {
      absolutePath: z.string().describe('Absolute path to the file to show diff for'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ absolutePath }) => {
    await queryRenderer(ctx.mainWindow, 'diff-open-viewer', { absolutePath });
    return {
      content: [{ type: 'text', text: `Opened diff viewer for: ${absolutePath}` }],
    };
  });
}
