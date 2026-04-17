import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getRecentShellCommands } from '../../main/services/shell-history-reader';

export function registerShellHistoryTools(server: McpServer): void {
  server.registerTool('shell_history_recent', {
    description:
      'List recent shell commands from the user\'s $HISTFILE ' +
      '(~/.zsh_history or ~/.bash_history). Used to verify that commands ' +
      'typed in bottom-panel terminals are surfaced in the `!` command palette.',
    inputSchema: {
      limit: z.number().int().positive().optional().describe('Max results (default: 500)'),
      query: z.string().optional().describe('Case-insensitive substring filter'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ limit, query }) => {
    const entries = await getRecentShellCommands({ limit, query });
    return {
      content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }],
    };
  });
}
