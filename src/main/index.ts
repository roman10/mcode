import { app, BrowserWindow, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { is, optimizer } from '@electron-toolkit/utils';
import { PtyManager } from './pty-manager';
import type { PtySpawnOptions } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let ptyManager: PtyManager;

function setupCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const connectSrc = app.isPackaged
      ? "connect-src 'self'"
      : "connect-src 'self' ws://localhost:* http://localhost:*";

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; ${connectSrc}`,
        ],
      },
    });
  });
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0d1117',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

function registerPtyIpc(): void {
  ipcMain.handle('pty:spawn', (_event, options: PtySpawnOptions) => {
    return ptyManager.spawn(options);
  });

  ipcMain.on('pty:write', (_event, id: string, data: string) => {
    ptyManager.write(id, data);
  });

  ipcMain.on('pty:resize', (_event, id: string, cols: number, rows: number) => {
    ptyManager.resize(id, cols, rows);
  });

  ipcMain.handle('pty:kill', (_event, id: string) => {
    return ptyManager.kill(id);
  });
}

app.whenReady().then(() => {
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  setupCSP();

  mainWindow = createMainWindow();

  ptyManager = new PtyManager(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return mainWindow.webContents;
    }
    return null;
  });

  registerPtyIpc();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

// Await PTY cleanup before quitting
let isQuitting = false;
app.on('before-quit', (e) => {
  if (!isQuitting && ptyManager?.list().length > 0) {
    isQuitting = true;
    e.preventDefault();
    ptyManager.killAll().finally(() => app.quit());
  }
});

// Part 1: quit on last window close on all platforms.
// No session persistence yet, so staying resident on macOS would orphan PTYs.
app.on('window-all-closed', () => {
  app.quit();
});
