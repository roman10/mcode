import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';

export function registerWindowTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('window_screenshot', {
    description: 'Take a screenshot of the app window, returns a base64 PNG image',
    inputSchema: {
      format: z
        .enum(['png', 'jpeg'])
        .optional()
        .describe('Image format (default: png)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ format }) => {
    const win = ctx.mainWindow;
    if (win.isDestroyed()) {
      return {
        content: [{ type: 'text', text: 'Window is destroyed' }],
        isError: true,
      };
    }

    const image = await win.webContents.capturePage();
    const fmt = format ?? 'png';
    const data =
      fmt === 'jpeg' ? image.toJPEG(85) : image.toPNG();

    return {
      content: [
        {
          type: 'image',
          data: data.toString('base64'),
          mimeType: fmt === 'jpeg' ? 'image/jpeg' : 'image/png',
        },
      ],
    };
  });

  server.registerTool('window_resize', {
    description: 'Resize the app window to the specified dimensions',
    inputSchema: {
      width: z.number().int().min(400).describe('Window width in pixels'),
      height: z.number().int().min(300).describe('Window height in pixels'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ width, height }) => {
    const win = ctx.mainWindow;
    if (win.isDestroyed()) {
      return {
        content: [{ type: 'text', text: 'Window is destroyed' }],
        isError: true,
      };
    }

    win.setSize(width, height);
    const [w, h] = win.getSize();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ width: w, height: h }),
        },
      ],
    };
  });

  server.registerTool('window_get_bounds', {
    description: 'Get the current window position and size',
    annotations: { readOnlyHint: true },
  }, async () => {
    const win = ctx.mainWindow;
    if (win.isDestroyed()) {
      return {
        content: [{ type: 'text', text: 'Window is destroyed' }],
        isError: true,
      };
    }

    const bounds = win.getBounds();
    return {
      content: [{ type: 'text', text: JSON.stringify(bounds) }],
    };
  });

  server.registerTool('window_execute_js', {
    description: 'Execute JavaScript in the renderer and return the result as JSON',
    inputSchema: {
      code: z.string().describe('JavaScript expression to evaluate (must return a value)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ code }) => {
    const win = ctx.mainWindow;
    if (win.isDestroyed()) {
      return {
        content: [{ type: 'text', text: 'Window is destroyed' }],
        isError: true,
      };
    }

    try {
      const result = await win.webContents.executeJavaScript(code);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to execute JS: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });
}
