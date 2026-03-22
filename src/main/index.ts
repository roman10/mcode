import { app, BrowserWindow, ipcMain, Menu, session, dialog, shell } from 'electron';
import { join } from 'node:path';
import { is, optimizer } from '@electron-toolkit/utils';
import { BrokerClient } from './broker-client';
import { ensureBroker, BROKER_SOCKET_PATH } from './broker-launcher';
import { SessionManager } from './session-manager';
import { AccountManager } from './account-manager';
import { TaskQueue } from './task-queue';
import { CommitTracker } from './commit-tracker';
import { GitChangesService } from './git-changes';
import { TokenTracker } from './token-tracker';
import { SleepBlocker } from './sleep-blocker';
import { FileLister } from './file-lister';
import { getPreference, setPreference } from './preferences';
import { startHookServer, stopHookServer } from './hook-server';
import { reconcileOnStartup, cleanupOnQuit } from './hook-config';
import { getDb, closeDb } from './db';
import { logger } from './logger';
import { fixPath } from './fix-path';
import { HOOK_PRUNE_INTERVAL_MS } from '../shared/constants';
import type {
  SessionCreateInput, CreateTaskInput, UpdateTaskInput, TaskFilter, HookRuntimeInfo,
  ExternalSessionInfo, AppCommand, SessionTokenUsage, DailyTokenUsage,
  ModelTokenBreakdown, TokenWeeklyTrend, TokenHeatmapEntry, AccountProfile,
} from '../shared/types';
import { fetchSubscriptionUsage, invalidateSubscriptionCache } from './claude-subscription-fetcher';

// Isolate dev data from production: separate userData/logs directory
if (!app.isPackaged) {
  app.name = 'mcode-dev';
}

// Fix PATH for packaged builds — GUI-launched apps get a minimal system PATH
// that doesn't include user-installed CLI tools like `claude`.
if (app.isPackaged) {
  fixPath();
}

let mainWindow: BrowserWindow | null = null;
let brokerClient: BrokerClient;
let sessionManager: SessionManager;
let accountManager: AccountManager;
let taskQueue: TaskQueue;
let commitTracker: CommitTracker;
let gitChangesService: GitChangesService;
let tokenTracker: TokenTracker;
let sleepBlocker: SleepBlocker;
let fileLister: FileLister;
let hookRuntimeInfo: HookRuntimeInfo = {
  state: 'initializing',
  port: null,
  warning: null,
};
let pruneInterval: ReturnType<typeof setInterval> | null = null;
let pollSessionStatesInterval: ReturnType<typeof setInterval> | null = null;

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
    brokerClient.write(id, data);
  });

  ipcMain.on('pty:resize', (_event, id: string, cols: number, rows: number) => {
    brokerClient.resize(id, cols, rows);
  });

  ipcMain.handle('pty:kill', (_event, id: string) => {
    return brokerClient.kill(id);
  });

  ipcMain.handle('pty:replay', (_event, sessionId: string) => {
    return brokerClient.fetchReplayFromBroker(sessionId);
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

  ipcMain.handle('session:delete-batch', (_event, sessionIds: string[]) => {
    return sessionManager.deleteBatch(sessionIds);
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

  ipcMain.handle('session:resume', (_event, { sessionId, accountId }: { sessionId: string; accountId?: string }) => {
    return sessionManager.resume(sessionId, accountId);
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
  ipcMain.handle('layout:save', (_event, mosaicTree: unknown, sidebarWidth?: number, sidebarCollapsed?: boolean, activeSidebarTab?: string) => {
    sessionManager.saveLayout(mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab);
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

  ipcMain.handle('task:update', (_event, taskId: number, input: UpdateTaskInput) => {
    return taskQueue.update(taskId, input);
  });

  ipcMain.handle('task:cancel', (_event, taskId: number) => {
    taskQueue.cancel(taskId);
  });
}

function registerTokenIpc(): void {
  ipcMain.handle('tokens:get-session-usage', (_event, claudeSessionId: string): SessionTokenUsage => {
    return tokenTracker.getSessionUsage(claudeSessionId);
  });

  ipcMain.handle('tokens:get-daily-usage', (_event, date?: string): DailyTokenUsage => {
    return tokenTracker.getDailyUsage(date);
  });

  ipcMain.handle('tokens:get-model-breakdown', (_event, days?: number): ModelTokenBreakdown[] => {
    return tokenTracker.getModelBreakdown(days);
  });

  ipcMain.handle('tokens:get-weekly-trend', (): TokenWeeklyTrend => {
    return tokenTracker.getWeeklyTrend();
  });

  ipcMain.handle('tokens:get-heatmap', (_event, days?: number): TokenHeatmapEntry[] => {
    return tokenTracker.getHeatmap(days);
  });

  ipcMain.handle('tokens:refresh', async () => {
    await tokenTracker.scanAll();
  });
}

function registerCommitIpc(): void {
  ipcMain.handle('commits:get-daily-stats', (_event, date?: string) => {
    return commitTracker.getDailyStats(date);
  });

  ipcMain.handle('commits:get-heatmap', (_event, days?: number) => {
    return commitTracker.getHeatmap(days);
  });

  ipcMain.handle('commits:get-streaks', () => {
    return commitTracker.getStreaks();
  });

  ipcMain.handle('commits:get-cadence', (_event, date?: string) => {
    return commitTracker.getCadence(date);
  });

  ipcMain.handle('commits:get-weekly-trend', () => {
    return commitTracker.getWeeklyTrend();
  });

  ipcMain.handle('commits:refresh', async () => {
    await commitTracker.scanAll();
  });
}

function registerGitChangesIpc(): void {
  ipcMain.handle('git:status', (_event, cwd: string) => {
    return gitChangesService.getStatus(cwd);
  });

  ipcMain.handle('git:diff-content', (_event, cwd: string, filePath: string) => {
    return gitChangesService.getDiffContent(cwd, filePath);
  });

  ipcMain.handle('git:all-statuses', () => {
    return gitChangesService.getAllStatuses();
  });

  ipcMain.handle('git:graph-log', (_event, repoPath: string, limit?: number, offset?: number) => {
    return gitChangesService.getGraphLog(repoPath, limit, offset);
  });

  ipcMain.handle('git:tracked-repos', () => {
    return gitChangesService.getTrackedRepos();
  });

  ipcMain.handle('git:commit-files', (_event, repoPath: string, commitHash: string) => {
    return gitChangesService.getCommitFiles(repoPath, commitHash);
  });

  ipcMain.handle('git:commit-file-diff', (_event, repoPath: string, commitHash: string, filePath: string) => {
    return gitChangesService.getCommitFileDiff(repoPath, commitHash, filePath);
  });

  ipcMain.handle('git:stage-file', (_event, repoRoot: string, filePath: string) => {
    return gitChangesService.stageFile(repoRoot, filePath);
  });

  ipcMain.handle('git:unstage-file', (_event, repoRoot: string, filePath: string) => {
    return gitChangesService.unstageFile(repoRoot, filePath);
  });

  ipcMain.handle('git:discard-file', (_event, repoRoot: string, filePath: string, isUntracked: boolean) => {
    return gitChangesService.discardFile(repoRoot, filePath, isUntracked);
  });

  ipcMain.handle('git:stage-all', (_event, repoRoot: string) => {
    return gitChangesService.stageAll(repoRoot);
  });

  ipcMain.handle('git:unstage-all', (_event, repoRoot: string) => {
    return gitChangesService.unstageAll(repoRoot);
  });

  ipcMain.handle('git:discard-all', (_event, repoRoot: string) => {
    return gitChangesService.discardAll(repoRoot);
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

  ipcMain.handle('hooks:get-recent-all', (_event, limit?: number) => {
    return sessionManager.getRecentAllEvents(limit ?? 200);
  });
}

function registerAccountIpc(): void {
  ipcMain.handle('account:list', (): AccountProfile[] => {
    return accountManager.list();
  });

  ipcMain.handle('account:create', (_event, name: string): AccountProfile => {
    return accountManager.create(name);
  });

  ipcMain.handle('account:delete', (_event, accountId: string): void => {
    accountManager.delete(accountId);
  });

  ipcMain.handle('account:get-auth-status', async (_event, accountId: string) => {
    const status = await accountManager.getAuthStatus(accountId);
    if (status.email) {
      accountManager.setEmail(accountId, status.email);
    }
    return status;
  });

  // Open a terminal session pre-configured with the account's HOME for `claude auth login`
  ipcMain.handle('account:open-auth-terminal', (_event, accountId: string): string => {
    const account = accountManager.get(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);
    if (account.isDefault) throw new Error('Default account uses standard auth');
    if (!account.homeDir) throw new Error('Account has no home directory');

    const session = sessionManager.create({
      cwd: account.homeDir,
      label: `Auth: ${account.name}`,
      sessionType: 'terminal',
      accountId,
    });
    return session.sessionId;
  });

  ipcMain.handle('account:get-subscription-usage', async (_event, accountId: string) => {
    const account = accountManager.get(accountId);
    if (!account) return null;
    return fetchSubscriptionUsage(account);
  });

  ipcMain.handle('account:invalidate-subscription-cache', (_event, accountId: string) => {
    invalidateSubscriptionCache(accountId);
  });
}

function registerFileIpc(): void {
  ipcMain.handle('files:list', (_event, cwd: string) => {
    return fileLister.listFiles(cwd);
  });

  ipcMain.handle('files:read', (_event, cwd: string, relativePath: string) => {
    return fileLister.readFile(cwd, relativePath);
  });

  ipcMain.handle('files:write', (_event, cwd: string, relativePath: string, content: string) => {
    return fileLister.writeFile(cwd, relativePath, content);
  });
}

async function initializeHookSystem(): Promise<void> {
  try {
    const result = await startHookServer(
      (sessionId, event) => {
        const handled = sessionManager.handleHookEvent(sessionId, event);
        if (handled) {
          commitTracker.onHookEvent(sessionId, event).catch(() => {});
          tokenTracker.onHookEvent(sessionId, event).catch(() => {});
          gitChangesService.onHookEvent(sessionId, event).catch(() => {});
        }
        return handled;
      },
      (claudeSessionId) => sessionManager.lookupByClaudeSessionId(claudeSessionId),
    );

    if (result.state === 'ready' && result.port) {
      try {
        const extraSettingsPaths = accountManager.getAllSettingsPaths().slice(1);
        reconcileOnStartup(result.port, extraSettingsPaths);
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

  // Custom menu with accelerators for app commands.
  // Omit 'close' role so Cmd+W falls through to the renderer for tile close.
  const sendCommand = (command: AppCommand): void => {
    const wc = getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('app:command', command);
    }
  };

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: 'Settings',
            accelerator: 'CmdOrCtrl+,',
            click: () => sendCommand({ command: 'show-settings' }),
          },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          {
            label: 'Quit and Kill All Sessions',
            accelerator: 'CmdOrCtrl+Shift+Q',
            click: async () => {
              await brokerClient.shutdownBroker();
              app.quit();
            },
          },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          {
            label: 'New Session',
            accelerator: 'CmdOrCtrl+N',
            click: () => sendCommand({ command: 'new-session' }),
          },
          {
            label: 'New Terminal',
            accelerator: 'CmdOrCtrl+T',
            click: () => sendCommand({ command: 'new-terminal' }),
          },
          {
            label: 'New Task',
            accelerator: 'CmdOrCtrl+Shift+T',
            click: () => sendCommand({ command: 'show-create-task' }),
          },
          {
            label: 'Run Shell Command',
            accelerator: 'CmdOrCtrl+Shift+E',
            click: () => sendCommand({ command: 'run-shell-command' }),
          },
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
        label: 'Sessions',
        submenu: [
          ...Array.from({ length: 9 }, (_, i) => ({
            label: `Focus Session ${i + 1}`,
            accelerator: `CmdOrCtrl+${i + 1}`,
            click: () => sendCommand({ command: 'focus-session-index', index: i }),
          })),
          { type: 'separator' as const },
          {
            label: 'Focus Next Session',
            accelerator: 'CmdOrCtrl+]',
            click: () => sendCommand({ command: 'focus-next-session' }),
          },
          {
            label: 'Focus Previous Session',
            accelerator: 'CmdOrCtrl+[',
            click: () => sendCommand({ command: 'focus-prev-session' }),
          },
          { type: 'separator' as const },
          {
            label: 'Clear All Attention',
            accelerator: 'CmdOrCtrl+Shift+M',
            click: () => sendCommand({ command: 'clear-all-attention' }),
          },
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Toggle Sidebar',
            accelerator: 'CmdOrCtrl+\\',
            click: () => sendCommand({ command: 'toggle-sidebar' }),
          },
          {
            label: 'Show Activity',
            accelerator: 'CmdOrCtrl+Shift+A',
            click: () => sendCommand({ command: 'switch-sidebar-tab', tab: 'activity' }),
          },
          {
            label: 'Show Commits',
            accelerator: 'CmdOrCtrl+Shift+B',
            click: () => sendCommand({ command: 'switch-sidebar-tab', tab: 'commits' }),
          },
          {
            label: 'Show Changes',
            accelerator: 'CmdOrCtrl+Shift+C',
            click: () => sendCommand({ command: 'switch-sidebar-tab', tab: 'changes' }),
          },
          {
            label: 'Show Token Usage',
            accelerator: 'CmdOrCtrl+Shift+U',
            click: () => sendCommand({ command: 'switch-sidebar-tab', tab: 'tokens' }),
          },
          {
            label: 'Quick Open',
            accelerator: 'CmdOrCtrl+P',
            click: () => sendCommand({ command: 'quick-open' }),
          },
          {
            label: 'Command Palette',
            accelerator: 'CmdOrCtrl+Shift+P',
            click: () => sendCommand({ command: 'show-command-palette' }),
          },
          { type: 'separator' },
          {
            label: 'Layout Mode',
            submenu: [
              {
                label: 'Tiles',
                type: 'radio',
                checked: true,
                click: () => sendCommand({ command: 'set-view-mode', mode: 'tiles' }),
              },
              {
                label: 'Kanban Board',
                type: 'radio',
                click: () => sendCommand({ command: 'set-view-mode', mode: 'kanban' }),
              },
            ],
          },
          {
            label: 'Toggle Layout Mode',
            accelerator: 'CmdOrCtrl+Shift+L',
            click: () => sendCommand({ command: 'toggle-view-mode' }),
          },
          { type: 'separator' },
          {
            label: 'Close All Tiles',
            accelerator: 'CmdOrCtrl+Shift+X',
            click: () => sendCommand({ command: 'close-all-tiles' }),
          },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
        ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Keyboard Shortcuts',
            accelerator: 'CmdOrCtrl+/',
            click: () => sendCommand({ command: 'show-keyboard-shortcuts' }),
          },
        ],
      },
    ]),
  );

  // Initialize database
  getDb();

  accountManager = new AccountManager();
  accountManager.ensureDefaultAccount();

  // Start (or connect to) PTY broker — holds PTY fds across app restarts
  await ensureBroker(BROKER_SOCKET_PATH);
  brokerClient = new BrokerClient();
  await brokerClient.connect(BROKER_SOCKET_PATH);

  // Forward PTY push events from broker → renderer IPC
  brokerClient.on('pty.data', (id: string, data: string) => {
    const wc = getWebContents();
    if (wc && !wc.isDestroyed()) wc.send('pty:data', id, data);
  });
  brokerClient.on('pty.exit', (id: string, code: number, signal?: number) => {
    const wc = getWebContents();
    if (wc && !wc.isDestroyed()) wc.send('pty:exit', id, { code, signal });
  });

  // On broker reconnect (e.g., after broker crash + respawn): reconcile session states
  brokerClient.on('reconnected', async () => {
    try {
      const alive = await brokerClient.listSessions();
      sessionManager.reconcileDetachedSessions(alive.map((s) => s.id));
      await Promise.all(alive.map((s) => brokerClient.populateFromBroker(s.id)));
    } catch (err) {
      logger.error('app', 'Failed to reconcile after broker reconnect', { err });
    }
  });

  // If broker becomes unreachable after retries, try respawning it
  brokerClient.on('broker-unavailable', async () => {
    logger.warn('app', 'Broker unavailable — attempting respawn');
    try {
      await ensureBroker(BROKER_SOCKET_PATH);
      await brokerClient.connect(BROKER_SOCKET_PATH);
      const alive = await brokerClient.listSessions();
      sessionManager.reconcileDetachedSessions(alive.map((s) => s.id));
      await Promise.all(alive.map((s) => brokerClient.populateFromBroker(s.id)));
    } catch (err) {
      logger.error('app', 'Failed to respawn broker', { err });
      sessionManager.reconcileDetachedSessions([]);
    }
  });

  sessionManager = new SessionManager(
    brokerClient,
    getWebContents,
    () => hookRuntimeInfo,
    accountManager,
  );
  sessionManager.deleteEmptyEnded();

  // Reconcile any sessions left detached from a previous app close
  const aliveSessions = await brokerClient.listSessions();
  sessionManager.reconcileDetachedSessions(aliveSessions.map((s) => s.id));
  // Populate local ring buffers so permission/task detection works immediately
  await Promise.all(aliveSessions.map((s) => brokerClient.populateFromBroker(s.id)));

  taskQueue = new TaskQueue(
    sessionManager,
    brokerClient,
    () => hookRuntimeInfo,
    getWebContents,
  );
  commitTracker = new CommitTracker(sessionManager, getWebContents);
  gitChangesService = new GitChangesService(sessionManager, getWebContents);
  fileLister = new FileLister();
  tokenTracker = new TokenTracker(getWebContents);
  sleepBlocker = new SleepBlocker();
  sleepBlocker.attach(sessionManager);

  registerPtyIpc();
  registerSessionIpc();
  registerLayoutIpc();
  registerFileIpc();
  registerAppIpc();
  registerHookIpc();
  registerAccountIpc();
  registerTaskIpc();
  registerCommitIpc();
  registerGitChangesIpc();
  registerTokenIpc();
  registerPreferencesIpc();

  // Create window AFTER IPC handlers are registered to avoid a race condition:
  // in production, loadFile() is near-instant, so the renderer can invoke IPC
  // handlers before they exist if the window is created earlier.
  mainWindow = createMainWindow();

  // Initialize hook system (server + config reconciliation)
  await initializeHookSystem();

  // Start task queue dispatch loop
  taskQueue.start();

  // Poll for permission prompts and stale session states (PTY-based fallback)
  pollSessionStatesInterval = setInterval(() => sessionManager.pollSessionStates(), 2000);

  // Start commit tracker and token tracker
  commitTracker.start();
  tokenTracker.start();

  // Wire commit tracker to hook events and session creation
  sessionManager.onSessionUpdated((session, previousStatus) => {
    // Trigger scan when a new session starts (starting -> active)
    if (previousStatus === 'starting' && session.status === 'active') {
      commitTracker.onSessionCreated(session.cwd).catch(() => {});
    }
  });

  // Start event pruning (also prune old commits)
  sessionManager.pruneOldEvents();
  commitTracker.pruneOldCommits();
  tokenTracker.pruneOldUsage();
  pruneInterval = setInterval(() => {
    sessionManager.pruneOldEvents();
    commitTracker.pruneOldCommits();
    tokenTracker.pruneOldUsage();
  }, HOOK_PRUNE_INTERVAL_MS);

  if (is.dev) {
    import('../devtools/mcp-server').then(({ startMcpServer }) => {
      startMcpServer({
        mainWindow: mainWindow!,
        ptyManager: brokerClient,
        sessionManager,
        taskQueue,
        commitTracker,
        gitChangesService,
        tokenTracker,
        getHookRuntimeInfo: () => hookRuntimeInfo,
        sleepBlocker,
        fileLister,
      });
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });

  // Scan repos/tokens when window regains focus (catches external activity)
  app.on('browser-window-focus', () => {
    commitTracker.scanAll().catch(() => {});
    tokenTracker.scanAll().catch(() => {});
  });
});

// Graceful shutdown: persist layout, end sessions, kill PTYs, close DB
let isQuitting = false;
app.on('before-quit', (e) => {
  if (!isQuitting) {
    isQuitting = true;
    e.preventDefault();

    logger.info('app', 'Shutting down...');

    // Clear polling intervals
    if (pruneInterval) {
      clearInterval(pruneInterval);
      pruneInterval = null;
    }
    if (pollSessionStatesInterval) {
      clearInterval(pollSessionStatesInterval);
      pollSessionStatesInterval = null;
    }

    // Release sleep blocker
    sleepBlocker.detach();

    // Stop task queue dispatch, commit tracker, and token tracker
    taskQueue.stop();
    commitTracker.stop();
    tokenTracker.stop();

    // Clean up hook config (primary + all secondary account settings)
    if (hookRuntimeInfo.port) {
      cleanupOnQuit(hookRuntimeInfo.port, accountManager.getAllSettingsPaths().slice(1));
    }
    stopHookServer();

    // Mark running sessions as detached (PTY broker keeps them alive)
    sessionManager.detachAllActive();

    // Disconnect from broker (broker stays running, PTYs stay alive)
    brokerClient.disconnect();

    closeDb();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
