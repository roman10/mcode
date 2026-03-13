import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';

export function registerWindowTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.tool(
    'window_screenshot',
    'Take a screenshot of the app window, returns a base64 PNG image',
    {
      format: z
        .enum(['png', 'jpeg'])
        .optional()
        .describe('Image format (default: png)'),
    },
    async ({ format }) => {
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
    },
  );

  server.tool(
    'window_resize',
    'Resize the app window to the specified dimensions',
    {
      width: z.number().int().min(400).describe('Window width in pixels'),
      height: z.number().int().min(300).describe('Window height in pixels'),
    },
    async ({ width, height }) => {
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
    },
  );

  server.tool(
    'window_get_bounds',
    'Get the current window position and size',
    async () => {
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
    },
  );
}
