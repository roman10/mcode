import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import { queryRenderer } from '../ipc';

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
      const content = await queryRenderer<string>(
        ctx.mainWindow,
        'terminal-buffer',
        { sessionId, lines },
      );
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
        const content = await queryRenderer<string>(ctx.mainWindow, 'terminal-buffer', { sessionId });
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
      const content = await queryRenderer<string>(ctx.mainWindow, 'terminal-buffer', { sessionId });
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
}
