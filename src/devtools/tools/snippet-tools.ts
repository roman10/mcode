import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { scanSnippets } from '../../main/snippet-scanner';

export function registerSnippetTools(
  server: McpServer,
): void {
  server.registerTool('snippet_list', {
    description:
      'List available prompt snippets. Scans ~/.mcode/snippets/ (user) and <cwd>/.mcode/snippets/ (project) for .md files with optional YAML frontmatter.',
    inputSchema: {
      cwd: z.string().describe('Working directory to scan for project-level snippets'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ cwd }) => {
    const entries = await scanSnippets(cwd);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(entries, null, 2),
        },
      ],
    };
  });
}
