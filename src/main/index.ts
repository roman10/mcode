import { app, BrowserWindow, session, dialog, shell } from 'electron';
import { join } from 'node:path';
import { is, optimizer } from '@electron-toolkit/utils';
import { BrokerClient, registerPtyIpc } from './pty/broker-client';
import { ensureBroker, BROKER_SOCKET_PATH } from './pty/broker-launcher';
import { SessionManager, registerSessionIpc } from './session/session-manager';
import { registerLayoutIpc } from './session/layout-repository';
import { AccountManager, registerAccountIpc } from './account-manager';
import { TaskQueue, registerTaskIpc } from './task-queue';
import { CommitTracker, registerCommitIpc } from './trackers/commit-tracker';
import { GitChangesService, registerGitChangesIpc } from './git-changes';
import { TokenTracker, registerTokenIpc } from './trackers/token-tracker';
import { InputTracker, registerInputIpc } from './trackers/input-tracker';
import { SleepBlocker } from './sleep-blocker';
import { FileLister, registerFileIpc } from './file-lister';
import { FileSearch, registerSearchIpc } from './file-search';
import { AutoUpdater } from './auto-updater';
import { registerSlashCommandIpc } from './slash-command-scanner';
import { registerSnippetIpc } from './snippet-scanner';
import { getPreference, setPreference, getPreferenceBool } from './preferences';
import { startHookServer, stopHookServer } from './hooks/hook-server';
import { reconcileOnStartup, cleanupOnQuit } from './hooks/hook-config';
import { writeBridgeScript, reconcileCodexHooks, cleanupCodexHooks } from './hooks/codex-hook-config';
import { getDb, closeDb } from './db';
import { logger } from './logger';
import { fixPath } from './fix-path';
import { buildApplicationMenu } from './menu';
import { typedHandle, typedOn } from './ipc-helpers';
import { HOOK_PRUNE_INTERVAL_MS } from '../shared/constants';
import type { HookRuntimeInfo, AppCommand } from '../shared/types';

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
let inputTracker: InputTracker;
let sleepBlocker: SleepBlocker;
let fileLister: FileLister;
let fileSearch: FileSearch;
let appUpdater: AutoUpdater;
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

  typedHandle('app:check-for-update', () => appUpdater.checkManual());
  typedHandle('app:open-update-page', () => appUpdater.openReleasePage());
  typedHandle('app:download-update', () => appUpdater.downloadUpdate());
  typedHandle('app:install-update', () => {
    isQuitting = true; // bypass close-confirmation dialog before quitAndInstall
    appUpdater.installUpdate();
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

      // Codex hook bridge: write bridge script + reconcile ~/.codex/hooks.json
      try {
        writeBridgeScript();
        reconcileCodexHooks();
        sessionManager.codexHookBridgeReady = true;
        logger.info('app', 'Codex hook bridge configured');
      } catch (err) {
        logger.warn('app', 'Codex hook bridge setup failed — Codex sessions will use fallback mode', {
          error: err instanceof Error ? err.message : String(err),
        });
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
    checkForUpdates: () => appUpdater.checkManual(),
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
  appUpdater = new AutoUpdater(getWebContents);
  inputTracker = new InputTracker();
  tokenTracker = new TokenTracker(getWebContents, inputTracker);
  sleepBlocker = new SleepBlocker();
  sleepBlocker.attach(sessionManager);

  registerPtyIpc(brokerClient);
  registerSessionIpc(sessionManager);
  registerLayoutIpc(sessionManager.layoutRepo);
  registerFileIpc(fileLister);
  registerSearchIpc(fileSearch);
  registerSlashCommandIpc();
  registerSnippetIpc();
  registerAppIpc();
  registerHookIpc();
  registerAccountIpc(accountManager, sessionManager);
  registerTaskIpc(taskQueue);
  registerCommitIpc(commitTracker);
  registerGitChangesIpc(gitChangesService);
  registerTokenIpc(tokenTracker);
  registerInputIpc(inputTracker);
  registerPreferencesIpc();

  // Create window AFTER IPC handlers are registered to avoid a race condition:
  // in production, loadFile() is near-instant, so the renderer can invoke IPC
  // handlers before they exist if the window is created earlier.
  mainWindow = createMainWindow();

  // Confirm before closing with active sessions (catches Cmd+W, red X, etc.)
  let forceClose = false;
  mainWindow.on('close', (e) => {
    if (isQuitting || forceClose) return;

    const counts = sessionManager.activeSessionCounts();
    if (counts.agent === 0) return; // terminal-only or nothing — close silently

    e.preventDefault();

    const n = counts.agent;
    const detail =
      counts.terminal > 0
        ? `Claude sessions will continue running in the background. ${counts.terminal} terminal session${counts.terminal === 1 ? '' : 's'} will be closed. You can reopen the app to reconnect.`
        : 'Claude sessions will continue running in the background. You can reopen the app to reconnect.';

    dialog
      .showMessageBox(mainWindow!, {
        type: 'question',
        message: `${n} Claude session${n === 1 ? ' is' : 's are'} still running`,
        detail,
        buttons: ['Close Window  ↵', 'Cancel  ⎋'],
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
  appUpdater.start();

  // Wire commit tracker to hook events and session creation
  sessionManager.onSessionUpdated((session, previousStatus) => {
    // Trigger scan when a new session starts (starting -> active)
    if (previousStatus === 'starting' && session.status === 'active') {
      commitTracker.onSessionCreated(session.cwd).catch(() => {});
    }
  });

  // Periodic cleanup: prune old hook events + stale file watermarks
  sessionManager.pruneOldEvents();
  tokenTracker.pruneStaleTrackedFiles();
  pruneInterval = setInterval(() => {
    sessionManager.pruneOldEvents();
    tokenTracker.pruneStaleTrackedFiles();
  }, HOOK_PRUNE_INTERVAL_MS);

  const mcpEnabled = is.dev || getPreferenceBool('mcpServerEnabled', false);
  if (mcpEnabled) {
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
        mode: is.dev ? 'dev' : 'production',
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
    appUpdater.stop();

    // Clean up hook config (primary + all secondary account settings)
    if (hookRuntimeInfo.port) {
      cleanupOnQuit(hookRuntimeInfo.port, accountManager.getAllSettingsPaths().slice(1));
    }
    cleanupCodexHooks();
    stopHookServer();

    // Kill terminal sessions immediately (no value running headless)
    sessionManager.killAllTerminalSessions();

    // Mark agent sessions as detached (PTY broker keeps them alive)
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
