import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { scanSnippets, createSnippetFromText } from '../../main/snippet-scanner';

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
      content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }],
    };
  });

  server.registerTool('snippet_create_from_text', {
    description:
      'Create a new snippet from a prompt text. Creates a .md file with the text as the body and opens it for editing.',
    inputSchema: {
      scope: z.enum(['user', 'project']).describe("Where to save: 'user' (~/.mcode/snippets/) or 'project' (<cwd>/.mcode/snippets/)"),
      cwd: z.string().describe('Working directory for project-level snippets'),
      text: z.string().describe('The prompt text to save as a snippet'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ scope, cwd, text }) => {
    const filePath = await createSnippetFromText(scope, cwd, text);
    return {
      content: [{ type: 'text', text: JSON.stringify({ filePath }, null, 2) }],
    };
  });
}
