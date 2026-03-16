import { app, BrowserWindow, ipcMain, session, dialog } from 'electron';
import { join } from 'node:path';
import { is, optimizer } from '@electron-toolkit/utils';
import { PtyManager } from './pty-manager';
import { SessionManager } from './session-manager';
import { getDb, closeDb } from './db';
import { logger } from './logger';
import type { SessionCreateInput } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let ptyManager: PtyManager;
let sessionManager: SessionManager;

function setupCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const scriptSrc = app.isPackaged
      ? "script-src 'self'"
      : "script-src 'self' 'unsafe-inline'";

    const connectSrc = app.isPackaged
      ? "connect-src 'self'"
      : "connect-src 'self' ws://localhost:* http://localhost:*";

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; ${connectSrc}`,
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

function getWebContents(): import('electron').WebContents | null {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.webContents;
  }
  return null;
}

function registerPtyIpc(): void {
  ipcMain.on('pty:write', (_event, id: string, data: string) => {
    ptyManager.write(id, data);
  });

  ipcMain.on('pty:resize', (_event, id: string, cols: number, rows: number) => {
    ptyManager.resize(id, cols, rows);
  });

  ipcMain.handle('pty:kill', (_event, id: string) => {
    return ptyManager.kill(id);
  });

  ipcMain.handle('pty:replay', (_event, sessionId: string) => {
    return ptyManager.getReplayData(sessionId);
  });
}

function registerSessionIpc(): void {
  ipcMain.handle('session:create', (_event, input: SessionCreateInput) => {
    return sessionManager.create(input);
  });

  ipcMain.handle('session:list', () => {
    return sessionManager.list();
  });

  ipcMain.handle('session:get', (_event, sessionId: string) => {
    return sessionManager.get(sessionId);
  });

  ipcMain.handle('session:kill', (_event, sessionId: string) => {
    return sessionManager.kill(sessionId);
  });

  ipcMain.handle(
    'session:set-label',
    (_event, sessionId: string, label: string) => {
      sessionManager.setLabel(sessionId, label);
    },
  );
}

function registerLayoutIpc(): void {
  ipcMain.handle('layout:save', (_event, mosaicTree: unknown, sidebarWidth?: number) => {
    sessionManager.saveLayout(mosaicTree, sidebarWidth);
  });

  ipcMain.handle('layout:load', () => {
    return sessionManager.loadLayout() ?? null;
  });
}

function registerAppIpc(): void {
  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:select-directory', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}

app.whenReady().then(() => {
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  setupCSP();

  // Initialize database
  getDb();

  mainWindow = createMainWindow();

  ptyManager = new PtyManager(getWebContents);
  sessionManager = new SessionManager(ptyManager, getWebContents);

  registerPtyIpc();
  registerSessionIpc();
  registerLayoutIpc();
  registerAppIpc();

  if (is.dev) {
    import('../devtools/mcp-server').then(({ startMcpServer }) => {
      startMcpServer({ mainWindow: mainWindow!, ptyManager, sessionManager });
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

// Graceful shutdown: persist layout, end sessions, kill PTYs, close DB
let isQuitting = false;
app.on('before-quit', (e) => {
  if (!isQuitting) {
    isQuitting = true;
    e.preventDefault();

    logger.info('app', 'Shutting down...');

    // Mark all active sessions as ended
    sessionManager.endAllActive();

    // Kill all PTYs then quit
    ptyManager
      .killAll()
      .finally(() => {
        closeDb();
        app.quit();
      });
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
