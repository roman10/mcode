import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import { queryRenderer } from '../ipc';
import { shellEscapePath } from '../../shared/shell-utils';

const WAIT_BUFFER_LINES = 2000;

async function readTerminalContent(
  ctx: McpServerContext,
  sessionId: string,
  lines?: number,
): Promise<string> {
  try {
    const rendered = await queryRenderer<string>(
      ctx.mainWindow,
      'terminal-buffer',
      { sessionId, lines },
    );
    if (rendered) return rendered;
  } catch {
    // Fall back to PTY replay when the terminal isn't mounted in the renderer.
  }

  const brokerReplay = ctx.ptyManager as typeof ctx.ptyManager & {
    fetchReplayFromBroker?: (id: string) => Promise<string>;
  };

  const replay = brokerReplay.fetchReplayFromBroker
    ? await brokerReplay.fetchReplayFromBroker(sessionId)
    : ctx.ptyManager.getReplayData(sessionId);
  if (!replay) return '';

  const normalized = replay.replace(/\r/g, '');
  if (!lines) return normalized;

  const chunks = normalized.split('\n');
  return chunks.slice(-lines).join('\n');
}

export function registerTerminalTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('terminal_read_buffer', {
    description: 'Read text content from the terminal buffer',
    inputSchema: {
      sessionId: z.string().describe('The PTY session ID'),
      lines: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Number of lines to read from bottom of buffer (default: visible viewport)',
        ),
    },
    annotations: { readOnlyHint: true },
  }, async ({ sessionId, lines }) => {
    if (!ctx.ptyManager.getInfo(sessionId)) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }

    try {
      const content = await readTerminalContent(ctx, sessionId, lines);
      return {
        content: [{ type: 'text', text: content }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to read buffer: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('terminal_send_keys', {
    description: 'Send keystrokes or text to the terminal. Use \\r for Enter, \\x03 for Ctrl+C, etc.',
    inputSchema: {
      sessionId: z.string().describe('The PTY session ID'),
      keys: z
        .string()
        .describe(
          'Text or escape sequences to send (e.g. "ls\\r" for ls+Enter, "\\x03" for Ctrl+C)',
        ),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId, keys }) => {
    if (!ctx.ptyManager.getInfo(sessionId)) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }

    // Process escape sequences in the string
    const processed = keys
      .replace(/\\r/g, '\r')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      )
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      );

    ctx.ptyManager.write(sessionId, processed);
    return {
      content: [
        { type: 'text', text: `Sent ${processed.length} character(s)` },
      ],
    };
  });

  server.registerTool('terminal_get_dimensions', {
    description: 'Get the current terminal dimensions (columns and rows)',
    inputSchema: {
      sessionId: z.string().describe('The PTY session ID'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ sessionId }) => {
    const info = ctx.ptyManager.getInfo(sessionId);
    if (!info) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ cols: info.cols, rows: info.rows }),
        },
      ],
    };
  });

  server.registerTool('terminal_resize', {
    description: 'Resize a terminal PTY to the specified dimensions',
    inputSchema: {
      sessionId: z.string().describe('The PTY session ID'),
      cols: z.number().int().positive().describe('Number of columns'),
      rows: z.number().int().positive().describe('Number of rows'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId, cols, rows }) => {
    const info = ctx.ptyManager.getInfo(sessionId);
    if (!info) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }
    ctx.ptyManager.resize(sessionId, cols, rows);
    return {
      content: [{ type: 'text', text: JSON.stringify({ cols, rows }) }],
    };
  });

  server.registerTool('terminal_execute_action', {
    description: 'Execute an action on a terminal instance (selectAll, copy, clear). For copy, returns the currently selected text. Use selectAll before copy to get all content. Paste is not supported — use terminal_send_keys to write text to the terminal instead.',
    inputSchema: {
      sessionId: z.string().describe('The PTY session ID'),
      action: z
        .enum(['copy', 'selectAll', 'clear'])
        .describe('Action to execute: copy (get selection), selectAll (select all text), clear (clear scrollback)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId, action }) => {
    if (!ctx.ptyManager.getInfo(sessionId)) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }

    try {
      const result = await queryRenderer<{ ok?: boolean; text?: string; error?: string }>(
        ctx.mainWindow,
        'terminal-action',
        { sessionId, action },
      );

      if (result.error) {
        return {
          content: [{ type: 'text', text: result.error }],
          isError: true,
        };
      }

      if (action === 'copy') {
        return {
          content: [{ type: 'text', text: result.text ?? '' }],
        };
      }

      return {
        content: [{ type: 'text', text: `Action '${action}' executed successfully` }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to execute action: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('terminal_wait_for_content', {
    description: 'Wait until a regex pattern appears in the terminal buffer. Polls every 250ms.',
    inputSchema: {
      sessionId: z.string().describe('The PTY session ID'),
      pattern: z
        .string()
        .describe('Regex pattern to match in the terminal buffer'),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Timeout in milliseconds (default: 10000)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ sessionId, pattern, timeout_ms }) => {
    if (!ctx.ptyManager.getInfo(sessionId)) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }

    const timeout = timeout_ms ?? 10000;
    const pollInterval = 250;
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const content = await readTerminalContent(ctx, sessionId, WAIT_BUFFER_LINES);
        if (regex.test(content)) {
          return {
            content: [{ type: 'text', text: content }],
          };
        }
      } catch {
        // Ignore transient IPC errors during polling
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    // Final attempt
    try {
      const content = await readTerminalContent(ctx, sessionId, WAIT_BUFFER_LINES);
      if (regex.test(content)) {
        return {
          content: [{ type: 'text', text: content }],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Timeout after ${timeout}ms waiting for pattern "${pattern}". Last buffer content:\n${content}`,
          },
        ],
        isError: true,
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Timeout after ${timeout}ms. Error reading buffer: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.registerTool('terminal_drop_files', {
    description: 'Simulate dropping files onto a terminal. Shell-escapes paths (quoting those with spaces/special chars) and writes them to the PTY, matching what happens when files are dragged from Finder.',
    inputSchema: {
      sessionId: z.string().describe('The PTY session ID'),
      filePaths: z
        .array(z.string())
        .min(1)
        .describe('Absolute file paths to drop'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ sessionId, filePaths }) => {
    if (!ctx.ptyManager.getInfo(sessionId)) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true,
      };
    }

    const escaped = filePaths.map(shellEscapePath).join(' ');
    ctx.ptyManager.write(sessionId, escaped);
    return {
      content: [
        { type: 'text', text: `Dropped ${filePaths.length} file(s): ${escaped}` },
      ],
    };
  });
}
