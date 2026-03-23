import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

const IPC_TIMEOUT_MS = 10000;

export function queryRenderer<T>(
  mainWindow: BrowserWindow,
  type: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (mainWindow.isDestroyed()) {
      reject(new Error('Window is destroyed'));
      return;
    }

    const requestId = randomUUID();
    const channel = `devtools:response:${requestId}`;
    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners(channel);
      reject(new Error(`Renderer query '${type}' timed out`));
    }, IPC_TIMEOUT_MS);

    ipcMain.once(channel, (_event, data: T) => {
      clearTimeout(timeout);
      resolve(data);
    });

    mainWindow.webContents.send('devtools:query', requestId, type, params);
  });
}
