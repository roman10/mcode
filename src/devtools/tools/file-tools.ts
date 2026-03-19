import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import { queryRenderer } from '../ipc';

export function registerFileTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('file_list', {
    description:
      'List files in a directory. Uses git ls-files for git repos, falls back to glob for non-git directories. Results are cached for 30 seconds.',
    inputSchema: {
      cwd: z.string().describe('Working directory to list files from'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ cwd }) => {
    const result = await ctx.fileLister.listFiles(cwd);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { isGitRepo: result.isGitRepo, count: result.files.length, files: result.files.slice(0, 100) },
            null,
            2,
          ),
        },
      ],
    };
  });

  server.registerTool('file_read', {
    description:
      'Read a file\'s content. Returns the content with detected language, or an error for binary/large files.',
    inputSchema: {
      cwd: z.string().describe('Working directory (base path for the file)'),
      relativePath: z.string().describe('Relative path to the file from cwd'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ cwd, relativePath }) => {
    const result = await ctx.fileLister.readFile(cwd, relativePath);
    if ('isBinary' in result) {
      return { content: [{ type: 'text', text: 'Binary file — cannot display.' }] };
    }
    if ('isTooLarge' in result) {
      return { content: [{ type: 'text', text: 'File too large (>1 MB).' }] };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ language: result.language, lines: result.content.split('\n').length }, null, 2),
        },
        { type: 'text', text: result.content },
      ],
    };
  });

  server.registerTool('file_write', {
    description:
      'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
    inputSchema: {
      cwd: z.string().describe('Working directory (base path for the file)'),
      relativePath: z.string().describe('Relative path to the file from cwd'),
      content: z.string().describe('Content to write to the file'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ cwd, relativePath, content }) => {
    await ctx.fileLister.writeFile(cwd, relativePath, content);
    return { content: [{ type: 'text', text: `Written ${content.length} characters to ${relativePath}` }] };
  });

  server.registerTool('file_open_viewer', {
    description:
      'Open a file in a read-only viewer tile in the mosaic layout.',
    inputSchema: {
      absolutePath: z.string().describe('Absolute path to the file to open'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ absolutePath }) => {
    await queryRenderer(ctx.mainWindow, 'file-open-viewer', { absolutePath });
    return { content: [{ type: 'text', text: `Opened file viewer for: ${absolutePath}` }] };
  });

  server.registerTool('quick_open_toggle', {
    description:
      'Toggle the quick open / command palette dialog. Can open in "files" or "commands" mode.',
    inputSchema: {
      mode: z.enum(['files', 'commands']).optional().default('files').describe('Mode to open in'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ mode }) => {
    await queryRenderer(ctx.mainWindow, 'quick-open-toggle', { mode });
    return { content: [{ type: 'text', text: `Toggled quick open in ${mode} mode` }] };
  });
}
