import { app, BrowserWindow, ipcMain, Menu, session, dialog, shell } from 'electron';
import { join } from 'node:path';
import { is, optimizer } from '@electron-toolkit/utils';
import { PtyManager } from './pty-manager';
import { SessionManager } from './session-manager';
import { TaskQueue } from './task-queue';
import { SleepBlocker } from './sleep-blocker';
import { getPreference, setPreference } from './preferences';
import { startHookServer, stopHookServer } from './hook-server';
import { reconcileOnStartup, cleanupOnQuit } from './hook-config';
import { getDb, closeDb } from './db';
import { logger } from './logger';
import { HOOK_PRUNE_INTERVAL_MS } from '../shared/constants';
import type { SessionCreateInput, CreateTaskInput, TaskFilter, HookRuntimeInfo, ExternalSessionInfo } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let ptyManager: PtyManager;
let sessionManager: SessionManager;
let taskQueue: TaskQueue;
let sleepBlocker: SleepBlocker;
let hookRuntimeInfo: HookRuntimeInfo = {
  state: 'initializing',
  port: null,
  warning: null,
};
let pruneInterval: ReturnType<typeof setInterval> | null = null;

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

  // Open http/https links in system browser; block all other window.open() calls
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch {
      // invalid URL — ignore
    }
    return { action: 'deny' };
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

  ipcMain.handle('session:delete', (_event, sessionId: string) => {
    sessionManager.delete(sessionId);
  });

  ipcMain.handle('session:delete-all-ended', () => {
    return sessionManager.deleteAllEnded();
  });

  ipcMain.handle('session:get-last-defaults', () => {
    return sessionManager.getLastDefaults();
  });

  ipcMain.handle(
    'session:set-label',
    (_event, sessionId: string, label: string) => {
      sessionManager.setLabel(sessionId, label);
    },
  );

  ipcMain.handle(
    'session:set-auto-label',
    (_event, sessionId: string, label: string) => {
      sessionManager.setAutoLabel(sessionId, label);
    },
  );

  ipcMain.handle(
    'session:set-terminal-config',
    (_event, sessionId: string, config: Record<string, unknown>) => {
      sessionManager.setTerminalConfig(sessionId, config);
    },
  );

  ipcMain.handle('session:clear-attention', (_event, sessionId: string) => {
    sessionManager.clearAttention(sessionId);
  });

  ipcMain.handle('session:clear-all-attention', () => {
    sessionManager.clearAllAttention();
  });

  ipcMain.handle('session:resume', (_event, sessionId: string) => {
    return sessionManager.resume(sessionId);
  });

  ipcMain.handle('session:list-external', async (_event, limit?: number) => {
    const cap = limit ?? 50;
    // Scan all unique cwds from Claude sessions (targeted query, avoids full deserialization)
    const cwds = new Set(sessionManager.getDistinctClaudeCwds());
    if (cwds.size === 0) cwds.add(process.cwd());

    // Fetch per-cwd sequentially (each call yields the event loop via async I/O)
    const all: ExternalSessionInfo[] = [];
    for (const cwd of cwds) {
      const results = await sessionManager.listExternalSessions(cwd, cap);
      all.push(...results);
    }
    all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return all.slice(0, cap);
  });

  ipcMain.handle(
    'session:import-external',
    (_event, claudeSessionId: string, cwd: string, label?: string) => {
      return sessionManager.importExternal(claudeSessionId, cwd, label);
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

  ipcMain.on('app:set-dock-badge', (_event, text: string) => {
    app.dock?.setBadge(text);
  });
}

function registerTaskIpc(): void {
  ipcMain.handle('task:create', (_event, input: CreateTaskInput) => {
    return taskQueue.create(input);
  });

  ipcMain.handle('task:list', (_event, filter?: TaskFilter) => {
    return taskQueue.list(filter);
  });

  ipcMain.handle('task:cancel', (_event, taskId: number) => {
    taskQueue.cancel(taskId);
  });
}

function registerPreferencesIpc(): void {
  ipcMain.handle('preferences:get', (_event, key: string) => {
    return getPreference(key);
  });

  ipcMain.handle('preferences:set', (_event, key: string, value: string) => {
    setPreference(key, value);
  });

  ipcMain.handle('preferences:get-sleep-status', () => {
    return {
      enabled: sleepBlocker.isEnabled(),
      blocking: sleepBlocker.isBlocking(),
    };
  });

  ipcMain.handle('preferences:set-prevent-sleep', (_event, enabled: boolean) => {
    sleepBlocker.setEnabled(enabled);
  });
}

function registerHookIpc(): void {
  ipcMain.handle('hooks:get-runtime', () => {
    return hookRuntimeInfo;
  });

  ipcMain.handle('hooks:get-recent', (_event, sessionId: string, limit?: number) => {
    return sessionManager.getRecentEvents(sessionId, limit ?? 50);
  });
}

async function initializeHookSystem(): Promise<void> {
  try {
    const result = await startHookServer(
      (sessionId, event) => sessionManager.handleHookEvent(sessionId, event),
      (claudeSessionId) => sessionManager.lookupByClaudeSessionId(claudeSessionId),
    );

    if (result.state === 'ready' && result.port) {
      try {
        reconcileOnStartup(result.port);
        hookRuntimeInfo = result;
      } catch (err) {
        hookRuntimeInfo = {
          state: 'degraded',
          port: result.port,
          warning: `Hook config failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    } else {
      hookRuntimeInfo = result;
    }
  } catch (err) {
    hookRuntimeInfo = {
      state: 'degraded',
      port: null,
      warning: `Hook server failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  logger.info('app', 'Hook system initialized', {
    state: hookRuntimeInfo.state,
    port: hookRuntimeInfo.port,
  });
}

app.whenReady().then(async () => {
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  setupCSP();

  // Custom menu: omit 'close' role so Cmd+W falls through to the renderer for tile close
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
        ],
      },
    ]),
  );

  // Initialize database
  getDb();

  mainWindow = createMainWindow();

  ptyManager = new PtyManager(getWebContents);
  sessionManager = new SessionManager(
    ptyManager,
    getWebContents,
    () => hookRuntimeInfo,
  );
  taskQueue = new TaskQueue(
    sessionManager,
    ptyManager,
    () => hookRuntimeInfo,
    getWebContents,
  );
  sleepBlocker = new SleepBlocker();
  sleepBlocker.attach(sessionManager);

  registerPtyIpc();
  registerSessionIpc();
  registerLayoutIpc();
  registerAppIpc();
  registerHookIpc();
  registerTaskIpc();
  registerPreferencesIpc();

  // Initialize hook system (server + config reconciliation)
  await initializeHookSystem();

  // Start task queue dispatch loop
  taskQueue.start();

  // Start event pruning
  sessionManager.pruneOldEvents();
  pruneInterval = setInterval(() => {
    sessionManager.pruneOldEvents();
  }, HOOK_PRUNE_INTERVAL_MS);

  if (is.dev) {
    import('../devtools/mcp-server').then(({ startMcpServer }) => {
      startMcpServer({
        mainWindow: mainWindow!,
        ptyManager,
        sessionManager,
        taskQueue,
        getHookRuntimeInfo: () => hookRuntimeInfo,
        sleepBlocker,
      });
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

    // Clear pruning interval
    if (pruneInterval) {
      clearInterval(pruneInterval);
      pruneInterval = null;
    }

    // Release sleep blocker
    sleepBlocker.detach();

    // Stop task queue dispatch
    taskQueue.stop();

    // Clean up hook config
    cleanupOnQuit();
    stopHookServer();

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
