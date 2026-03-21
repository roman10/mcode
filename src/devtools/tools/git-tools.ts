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
      'Get git status (uncommitted changes) for a specific working directory. Returns staged (index) and unstaged (worktree) file arrays with their status (modified, added, deleted, renamed, untracked).',
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

  server.registerTool('git_stage_file', {
    description: 'Stage a specific file (git add). Moves the file from the working tree to the index.',
    inputSchema: {
      repoRoot: z.string().describe('Absolute path to the git repository root'),
      filePath: z.string().describe('Path to the file relative to the repo root'),
    },
  }, async ({ repoRoot, filePath }) => {
    await ctx.gitChangesService.stageFile(repoRoot, filePath);
    return { content: [{ type: 'text', text: `Staged: ${filePath}` }] };
  });

  server.registerTool('git_unstage_file', {
    description: 'Unstage a specific file (git restore --staged). Moves the file from the index back to the working tree.',
    inputSchema: {
      repoRoot: z.string().describe('Absolute path to the git repository root'),
      filePath: z.string().describe('Path to the file relative to the repo root'),
    },
  }, async ({ repoRoot, filePath }) => {
    await ctx.gitChangesService.unstageFile(repoRoot, filePath);
    return { content: [{ type: 'text', text: `Unstaged: ${filePath}` }] };
  });

  server.registerTool('git_discard_file', {
    description: 'Discard working tree changes for a specific file (git restore). For untracked files, deletes them (git clean -f).',
    inputSchema: {
      repoRoot: z.string().describe('Absolute path to the git repository root'),
      filePath: z.string().describe('Path to the file relative to the repo root'),
      isUntracked: z.boolean().describe('Whether the file is untracked (not tracked by git)'),
    },
  }, async ({ repoRoot, filePath, isUntracked }) => {
    await ctx.gitChangesService.discardFile(repoRoot, filePath, isUntracked);
    return { content: [{ type: 'text', text: `Discarded changes: ${filePath}` }] };
  });

  server.registerTool('git_stage_all', {
    description: 'Stage all changes in a repository (git add -A).',
    inputSchema: {
      repoRoot: z.string().describe('Absolute path to the git repository root'),
    },
  }, async ({ repoRoot }) => {
    await ctx.gitChangesService.stageAll(repoRoot);
    return { content: [{ type: 'text', text: `Staged all changes in: ${repoRoot}` }] };
  });

  server.registerTool('git_unstage_all', {
    description: 'Unstage all staged changes in a repository (git restore --staged .).',
    inputSchema: {
      repoRoot: z.string().describe('Absolute path to the git repository root'),
    },
  }, async ({ repoRoot }) => {
    await ctx.gitChangesService.unstageAll(repoRoot);
    return { content: [{ type: 'text', text: `Unstaged all changes in: ${repoRoot}` }] };
  });

  server.registerTool('git_discard_all', {
    description: 'Discard all tracked file changes in a repository (git restore .). Does not delete untracked files — use git_discard_file for those.',
    inputSchema: {
      repoRoot: z.string().describe('Absolute path to the git repository root'),
    },
  }, async ({ repoRoot }) => {
    await ctx.gitChangesService.discardAll(repoRoot);
    return { content: [{ type: 'text', text: `Discarded all tracked changes in: ${repoRoot}` }] };
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
