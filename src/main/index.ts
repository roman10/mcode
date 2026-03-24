import { app, BrowserWindow, ipcMain, session, dialog, shell } from 'electron';
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
import { FileSearch } from './file-search';
import { UpdateChecker } from './update-checker';
import { scanSlashCommands } from './slash-command-scanner';
import { scanSnippets, createSnippet, deleteSnippet, openSnippetsFolder } from './snippet-scanner';
import { getPreference, setPreference } from './preferences';
import { startHookServer, stopHookServer } from './hook-server';
import { reconcileOnStartup, cleanupOnQuit } from './hook-config';
import { getDb, closeDb } from './db';
import { logger } from './logger';
import { fixPath } from './fix-path';
import { buildApplicationMenu } from './menu';
import { HOOK_PRUNE_INTERVAL_MS } from '../shared/constants';
import type {
  HookRuntimeInfo, ExternalSessionInfo, AppCommand, LayoutStateSnapshot,
} from '../shared/types';
import type { IpcInvokeContract, IpcInvokeHandler, IpcSendContract, IpcSendHandler } from '../shared/ipc-contract';
import { fetchSubscriptionUsage, invalidateSubscriptionCache } from './claude-subscription-fetcher';

// Typed IPC wrappers — channel names and parameter types are checked against the contract
function typedHandle<K extends keyof IpcInvokeContract>(
  channel: K,
  handler: IpcInvokeHandler<K>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ipcMain.handle(channel, (_event, ...args: any[]) =>
    handler(...(args as IpcInvokeContract[K]['params'])),
  );
}

function typedOn<K extends keyof IpcSendContract>(
  channel: K,
  handler: IpcSendHandler<K>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ipcMain.on(channel, (_event, ...args: any[]) =>
    handler(...(args as IpcSendContract[K]['params'])),
  );
}

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
let fileSearch: FileSearch;
let updateChecker: UpdateChecker;
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
  typedOn('pty:write', (id, data) => {
    brokerClient.write(id, data);
  });

  typedOn('pty:resize', (id, cols, rows) => {
    brokerClient.resize(id, cols, rows);
  });

  typedHandle('pty:kill', (id) => {
    return brokerClient.kill(id);
  });

  typedHandle('pty:replay', (sessionId) => {
    return brokerClient.fetchReplayFromBroker(sessionId);
  });
}

function registerSessionIpc(): void {
  typedHandle('session:create', (input) => {
    return sessionManager.create(input);
  });

  typedHandle('session:list', () => {
    return sessionManager.list();
  });

  typedHandle('session:get', (sessionId) => {
    return sessionManager.get(sessionId);
  });

  typedHandle('session:kill', (sessionId) => {
    return sessionManager.kill(sessionId);
  });

  typedHandle('session:delete', (sessionId) => {
    sessionManager.delete(sessionId);
  });

  typedHandle('session:delete-all-ended', () => {
    return sessionManager.deleteAllEnded();
  });

  typedHandle('session:delete-batch', (sessionIds) => {
    return sessionManager.deleteBatch(sessionIds);
  });

  typedHandle('session:get-last-defaults', () => {
    return sessionManager.getLastDefaults();
  });

  typedHandle('session:set-label', (sessionId, label) => {
    sessionManager.setLabel(sessionId, label);
  });

  typedHandle('session:set-auto-label', (sessionId, label) => {
    sessionManager.setAutoLabel(sessionId, label);
  });

  typedHandle('session:set-terminal-config', (sessionId, config) => {
    sessionManager.setTerminalConfig(sessionId, config);
  });

  typedHandle('session:clear-attention', (sessionId) => {
    sessionManager.clearAttention(sessionId);
  });

  typedHandle('session:clear-all-attention', () => {
    sessionManager.clearAllAttention();
  });

  typedHandle('session:resume', ({ sessionId, accountId }) => {
    return sessionManager.resume(sessionId, accountId);
  });

  typedHandle('session:list-external', async (limit) => {
    const cap = limit ?? 50;
    const cwds = new Set(sessionManager.getDistinctClaudeCwds());
    if (cwds.size === 0) cwds.add(process.cwd());

    const all: ExternalSessionInfo[] = [];
    for (const cwd of cwds) {
      const results = await sessionManager.listExternalSessions(cwd, cap);
      all.push(...results);
    }
    all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return all.slice(0, cap);
  });

  typedHandle('session:import-external', (claudeSessionId, cwd, label) => {
    return sessionManager.importExternal(claudeSessionId, cwd, label);
  });
}

function registerLayoutIpc(): void {
  typedHandle('layout:save', (mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab) => {
    sessionManager.saveLayout(mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab);
  });

  typedHandle('layout:load', () => {
    return (sessionManager.loadLayout() ?? null) as LayoutStateSnapshot | null;
  });
}

function registerAppIpc(): void {
  typedHandle('app:get-version', () => {
    return app.getVersion();
  });

  typedHandle('app:select-directory', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  typedOn('app:set-dock-badge', (text) => {
    app.dock?.setBadge(text);
  });

  typedHandle('app:check-for-update', () => updateChecker.checkManual());
  typedHandle('app:open-update-page', () => updateChecker.openUpdatePage());
}

function registerTaskIpc(): void {
  typedHandle('task:create', (input) => {
    return taskQueue.create(input);
  });

  typedHandle('task:list', (filter) => {
    return taskQueue.list(filter);
  });

  typedHandle('task:update', (taskId, input) => {
    return taskQueue.update(taskId, input);
  });

  typedHandle('task:cancel', (taskId) => {
    taskQueue.cancel(taskId);
  });
}

function registerTokenIpc(): void {
  typedHandle('tokens:get-session-usage', (claudeSessionId) => {
    return tokenTracker.getSessionUsage(claudeSessionId);
  });

  typedHandle('tokens:get-daily-usage', (date) => {
    return tokenTracker.getDailyUsage(date);
  });

  typedHandle('tokens:get-model-breakdown', (days) => {
    return tokenTracker.getModelBreakdown(days);
  });

  typedHandle('tokens:get-weekly-trend', () => {
    return tokenTracker.getWeeklyTrend();
  });

  typedHandle('tokens:get-heatmap', (days) => {
    return tokenTracker.getHeatmap(days);
  });

  typedHandle('tokens:refresh', async () => {
    await tokenTracker.scanAll();
  });
}

function registerCommitIpc(): void {
  typedHandle('commits:get-daily-stats', (date) => {
    return commitTracker.getDailyStats(date);
  });

  typedHandle('commits:get-heatmap', (days) => {
    return commitTracker.getHeatmap(days);
  });

  typedHandle('commits:get-streaks', () => {
    return commitTracker.getStreaks();
  });

  typedHandle('commits:get-cadence', (date) => {
    return commitTracker.getCadence(date);
  });

  typedHandle('commits:get-weekly-trend', () => {
    return commitTracker.getWeeklyTrend();
  });

  typedHandle('commits:refresh', async () => {
    await commitTracker.scanAll();
  });
}

function registerGitChangesIpc(): void {
  typedHandle('git:status', (cwd) => {
    return gitChangesService.getStatus(cwd);
  });

  typedHandle('git:diff-content', (cwd, filePath) => {
    return gitChangesService.getDiffContent(cwd, filePath);
  });

  typedHandle('git:all-statuses', () => {
    return gitChangesService.getAllStatuses();
  });

  typedHandle('git:graph-log', (repoPath, limit, offset) => {
    return gitChangesService.getGraphLog(repoPath, limit, offset);
  });

  typedHandle('git:tracked-repos', () => {
    return gitChangesService.getTrackedRepos();
  });

  typedHandle('git:commit-files', (repoPath, commitHash) => {
    return gitChangesService.getCommitFiles(repoPath, commitHash);
  });

  typedHandle('git:commit-file-diff', (repoPath, commitHash, filePath) => {
    return gitChangesService.getCommitFileDiff(repoPath, commitHash, filePath);
  });

  typedHandle('git:stage-file', (repoRoot, filePath) => {
    return gitChangesService.stageFile(repoRoot, filePath);
  });

  typedHandle('git:unstage-file', (repoRoot, filePath) => {
    return gitChangesService.unstageFile(repoRoot, filePath);
  });

  typedHandle('git:discard-file', (repoRoot, filePath, isUntracked) => {
    return gitChangesService.discardFile(repoRoot, filePath, isUntracked);
  });

  typedHandle('git:stage-all', (repoRoot) => {
    return gitChangesService.stageAll(repoRoot);
  });

  typedHandle('git:unstage-all', (repoRoot) => {
    return gitChangesService.unstageAll(repoRoot);
  });

  typedHandle('git:discard-all', (repoRoot) => {
    return gitChangesService.discardAll(repoRoot);
  });
}

function registerPreferencesIpc(): void {
  typedHandle('preferences:get', (key) => {
    return getPreference(key);
  });

  typedHandle('preferences:set', (key, value) => {
    setPreference(key, value);
  });

  typedHandle('preferences:get-sleep-status', () => {
    return {
      enabled: sleepBlocker.isEnabled(),
      blocking: sleepBlocker.isBlocking(),
    };
  });

  typedHandle('preferences:set-prevent-sleep', (enabled) => {
    sleepBlocker.setEnabled(enabled);
  });
}

function registerHookIpc(): void {
  typedHandle('hooks:get-runtime', () => {
    return hookRuntimeInfo;
  });

  typedHandle('hooks:get-recent', (sessionId, limit) => {
    return sessionManager.getRecentEvents(sessionId, limit ?? 50);
  });

  typedHandle('hooks:get-recent-all', (limit) => {
    return sessionManager.getRecentAllEvents(limit ?? 200);
  });

  typedHandle('hooks:clear-all', () => {
    sessionManager.clearAllEvents();
  });
}

function registerAccountIpc(): void {
  typedHandle('account:list', () => {
    return accountManager.list();
  });

  typedHandle('account:create', (name) => {
    return accountManager.create(name);
  });

  typedHandle('account:rename', (accountId, name) => {
    accountManager.rename(accountId, name);
  });

  typedHandle('account:delete', (accountId) => {
    accountManager.delete(accountId);
  });

  typedHandle('account:get-auth-status', async (accountId) => {
    const result = await accountManager.getAuthStatus(accountId);
    if (result.email) {
      accountManager.setEmail(accountId, result.email);
    }
    return result;
  });

  typedHandle('account:check-cli-installed', async () => {
    return accountManager.checkCliInstalled();
  });

  typedHandle('account:open-auth-terminal', (accountId) => {
    const account = accountManager.get(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);
    if (account.isDefault) throw new Error('Default account uses standard auth');
    if (!account.homeDir) throw new Error('Account has no home directory');

    const session = sessionManager.create(
      { cwd: account.homeDir, label: `Auth: ${account.name}`, sessionType: 'terminal', accountId },
      { initialCommand: 'claude auth login' },
    );
    return session.sessionId;
  });

  typedHandle('account:get-subscription-usage', async (accountId) => {
    const account = accountManager.get(accountId);
    if (!account) return null;
    return fetchSubscriptionUsage(account);
  });

  typedHandle('account:invalidate-subscription-cache', (accountId) => {
    invalidateSubscriptionCache(accountId);
  });
}

function registerFileIpc(): void {
  typedHandle('files:list', (cwd) => {
    return fileLister.listFiles(cwd);
  });

  typedHandle('files:read', (cwd, relativePath) => {
    return fileLister.readFile(cwd, relativePath);
  });

  typedHandle('files:write', (cwd, relativePath, content) => {
    return fileLister.writeFile(cwd, relativePath, content);
  });
}

function registerSearchIpc(): void {
  typedHandle('search:start', (request) => {
    return fileSearch.search(request);
  });

  typedHandle('search:cancel', (searchId) => {
    fileSearch.cancel(searchId);
  });
}

function registerSlashCommandIpc(): void {
  typedHandle('slash-commands:scan', (cwd) => {
    return scanSlashCommands(cwd);
  });
}

function registerSnippetIpc(): void {
  typedHandle('snippets:scan', (cwd) => {
    return scanSnippets(cwd);
  });
  typedHandle('snippets:create', (scope, cwd) => {
    return createSnippet(scope, cwd);
  });
  typedHandle('snippets:delete', (filePath) => {
    return deleteSnippet(filePath);
  });
  typedHandle('snippets:open-folder', (scope, cwd) => {
    return openSnippetsFolder(scope, cwd);
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

  const sendCommand = (command: AppCommand): void => {
    const wc = getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('app:command', command);
    }
  };

  buildApplicationMenu({
    sendCommand,
    shutdownBroker: () => brokerClient.shutdownBroker(),
    checkForUpdates: () => updateChecker.checkManual(),
  });

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
  // Immediately detect sessions that transitioned while the app was closed
  // (e.g., active sessions that finished and are now at the ❯ prompt)
  sessionManager.pollSessionStates();

  taskQueue = new TaskQueue(
    sessionManager,
    brokerClient,
    () => hookRuntimeInfo,
    getWebContents,
  );
  commitTracker = new CommitTracker(sessionManager, getWebContents);
  gitChangesService = new GitChangesService(sessionManager, getWebContents);
  fileLister = new FileLister();
  fileSearch = new FileSearch();
  fileSearch.addListener((event) => {
    const wc = getWebContents();
    if (wc && !wc.isDestroyed()) wc.send('search:event', event);
  });
  updateChecker = new UpdateChecker(getWebContents);
  tokenTracker = new TokenTracker(getWebContents);
  sleepBlocker = new SleepBlocker();
  sleepBlocker.attach(sessionManager);

  registerPtyIpc();
  registerSessionIpc();
  registerLayoutIpc();
  registerFileIpc();
  registerSearchIpc();
  registerSlashCommandIpc();
  registerSnippetIpc();
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

  // Confirm before closing with active sessions (catches Cmd+W, red X, etc.)
  let forceClose = false;
  mainWindow.on('close', (e) => {
    if (isQuitting || forceClose) return;

    const activeCount = sessionManager.activeSessionCount();
    if (activeCount === 0) return;

    e.preventDefault();

    dialog
      .showMessageBox(mainWindow!, {
        type: 'question',
        message: `${activeCount} session${activeCount === 1 ? ' is' : 's are'} still running`,
        detail:
          'Sessions will continue running in the background. You can reopen the app to reconnect.',
        buttons: ['Close Window', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          forceClose = true;
          mainWindow?.close();
        }
      });
  });

  // Initialize hook system (server + config reconciliation)
  await initializeHookSystem();

  // Start task queue dispatch loop
  taskQueue.start();

  // Poll for permission prompts and stale session states (PTY-based fallback)
  pollSessionStatesInterval = setInterval(() => sessionManager.pollSessionStates(), 2000);

  // Start commit tracker, token tracker, and update checker
  commitTracker.start();
  tokenTracker.start();
  updateChecker.start();

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
        fileSearch,
        accountManager,
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

    // Stop task queue dispatch, commit tracker, token tracker, update checker, and search
    taskQueue.stop();
    commitTracker.stop();
    fileSearch.cancelAll();
    tokenTracker.stop();
    updateChecker.stop();

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
