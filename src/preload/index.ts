import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  LayoutStateSnapshot,
  PtyExitPayload,
  SessionInfo,
  SessionCreateInput,
  SessionDefaults,
  ExternalSessionInfo,
  HookRuntimeInfo,
  HookEvent,
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskChangeEvent,
  AppCommand,
  DailyCommitStats,
  CommitHeatmapEntry,
  CommitStreakInfo,
  CommitCadenceInfo,
  CommitWeeklyTrend,
  FileListResult,
  FileReadResult,
  GitStatusResult,
  GitDiffContent,
  CommitGraphResult,
  CommitFileEntry,
  SessionTokenUsage,
  DailyTokenUsage,
  ModelTokenBreakdown,
  TokenWeeklyTrend,
  TokenHeatmapEntry,
  AccountProfile,
  AuthStatusResult,
  CliAuthStatus,
  SubscriptionUsage,
  SlashCommandEntry,
  SnippetEntry,
  FileSearchRequest,
  SearchEvent,
} from '../shared/types';
import type { IpcInvokeContract, IpcSendContract, IpcPushContract } from '../shared/ipc-contract';

// Typed IPC wrappers — channel names and types are checked against the contract

function typedInvoke<K extends keyof IpcInvokeContract>(
  channel: K,
  ...args: IpcInvokeContract[K]['params']
): Promise<IpcInvokeContract[K]['result']> {
  return ipcRenderer.invoke(channel, ...args);
}

function typedSend<K extends keyof IpcSendContract>(
  channel: K,
  ...args: IpcSendContract[K]['params']
): void {
  ipcRenderer.send(channel, ...args);
}

function typedListen<K extends keyof IpcPushContract>(
  channel: K,
  callback: (...args: IpcPushContract[K]['params']) => void,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = (_e: Electron.IpcRendererEvent, ...args: any[]) =>
    callback(...(args as IpcPushContract[K]['params']));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';

contextBridge.exposeInMainWorld('mcode', {
  accounts: {
    list: (): Promise<AccountProfile[]> =>
      typedInvoke('account:list'),

    create: (name?: string): Promise<AccountProfile> =>
      typedInvoke('account:create', name),

    rename: (accountId: string, name: string): Promise<void> =>
      typedInvoke('account:rename', accountId, name),

    delete: (accountId: string): Promise<void> =>
      typedInvoke('account:delete', accountId),

    getAuthStatus: (accountId: string): Promise<AuthStatusResult> =>
      typedInvoke('account:get-auth-status', accountId),

    checkCliInstalled: (): Promise<CliAuthStatus> =>
      typedInvoke('account:check-cli-installed').then((r) => r.status),

    openAuthTerminal: (accountId: string): Promise<string> =>
      typedInvoke('account:open-auth-terminal', accountId),

    getSubscriptionUsage: (accountId: string, forceRefresh?: boolean): Promise<SubscriptionUsage | null> =>
      typedInvoke('account:get-subscription-usage', accountId, forceRefresh),
  },

  pty: {
    write: (id: string, data: string): void => {
      typedSend('pty:write', id, data);
    },

    resize: (id: string, cols: number, rows: number): void => {
      typedSend('pty:resize', id, cols, rows);
    },

    kill: (id: string): Promise<void> => typedInvoke('pty:kill', id),

    onData: (cb: (sessionId: string, data: string) => void): (() => void) =>
      typedListen('pty:data', cb),

    onExit: (
      cb: (sessionId: string, payload: PtyExitPayload) => void,
    ): (() => void) =>
      typedListen('pty:exit', cb),

    getReplayData: (sessionId: string): Promise<string> =>
      typedInvoke('pty:replay', sessionId),
  },

  sessions: {
    create: (input: SessionCreateInput): Promise<SessionInfo> =>
      typedInvoke('session:create', input),

    list: (): Promise<SessionInfo[]> => typedInvoke('session:list'),

    get: (sessionId: string): Promise<SessionInfo | null> =>
      typedInvoke('session:get', sessionId),

    kill: (sessionId: string): Promise<void> =>
      typedInvoke('session:kill', sessionId),

    setLabel: (sessionId: string, label: string): Promise<void> =>
      typedInvoke('session:set-label', sessionId, label),

    setAutoLabel: (sessionId: string, label: string): Promise<void> =>
      typedInvoke('session:set-auto-label', sessionId, label),

    setTerminalConfig: (sessionId: string, config: Record<string, unknown>): Promise<void> =>
      typedInvoke('session:set-terminal-config', sessionId, config),

    clearAttention: (sessionId: string): Promise<void> =>
      typedInvoke('session:clear-attention', sessionId),

    clearAllAttention: (): Promise<void> =>
      typedInvoke('session:clear-all-attention'),

    resume: (sessionId: string, accountId?: string): Promise<SessionInfo> =>
      typedInvoke('session:resume', { sessionId, accountId }),

    listExternal: (limit?: number): Promise<ExternalSessionInfo[]> =>
      typedInvoke('session:list-external', limit),

    importExternal: (claudeSessionId: string, cwd: string, label?: string): Promise<SessionInfo> =>
      typedInvoke('session:import-external', claudeSessionId, cwd, label),

    onUpdated: (cb: (session: SessionInfo) => void): (() => void) =>
      typedListen('session:updated', cb),

    onCreated: (cb: (session: SessionInfo) => void): (() => void) =>
      typedListen('session:created', cb),

    getLastDefaults: (): Promise<SessionDefaults | null> =>
      typedInvoke('session:get-last-defaults'),

    delete: (sessionId: string): Promise<void> =>
      typedInvoke('session:delete', sessionId),

    deleteAllEnded: (): Promise<string[]> =>
      typedInvoke('session:delete-all-ended'),

    deleteBatch: (sessionIds: string[]): Promise<string[]> =>
      typedInvoke('session:delete-batch', sessionIds),

    onDeleted: (cb: (sessionId: string) => void): (() => void) =>
      typedListen('session:deleted', cb),

    onDeletedBatch: (cb: (sessionIds: string[]) => void): (() => void) =>
      typedListen('session:deleted-batch', cb),
  },

  hooks: {
    getRuntime: (): Promise<HookRuntimeInfo> =>
      typedInvoke('hooks:get-runtime'),

    onEvent: (cb: (event: HookEvent) => void): (() => void) =>
      typedListen('hook:event', cb),

    getRecent: (sessionId: string, limit?: number): Promise<HookEvent[]> =>
      typedInvoke('hooks:get-recent', sessionId, limit ?? 50),

    getRecentAll: (limit?: number): Promise<HookEvent[]> =>
      typedInvoke('hooks:get-recent-all', limit ?? 200),

    clearAll: (): Promise<void> =>
      typedInvoke('hooks:clear-all'),
  },

  layout: {
    save: (mosaicTree: unknown, sidebarWidth?: number, sidebarCollapsed?: boolean, activeSidebarTab?: string, terminalPanelState?: unknown): Promise<void> =>
      typedInvoke('layout:save', mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab, terminalPanelState),

    load: (): Promise<LayoutStateSnapshot | null> =>
      typedInvoke('layout:load'),
  },

  app: {
    getVersion: (): Promise<string> => typedInvoke('app:get-version'),

    getPlatform: (): string => process.platform,

    getHomeDir: (): string => homeDir,

    selectDirectory: (): Promise<string | null> =>
      typedInvoke('app:select-directory'),

    setDockBadge: (text: string): void => {
      typedSend('app:set-dock-badge', text);
    },

    getPathForFile: (file: File): string => webUtils.getPathForFile(file),

    onError: (cb: (error: string) => void): (() => void) =>
      typedListen('app:error', cb),

    onCommand: (cb: (command: AppCommand) => void): (() => void) =>
      typedListen('app:command', cb),

    onUpdateAvailable: (cb: (info: { version: string }) => void): (() => void) =>
      typedListen('app:update-available', cb),

    openUpdatePage: (): Promise<void> =>
      typedInvoke('app:open-update-page'),

    checkForUpdate: (): Promise<void> =>
      typedInvoke('app:check-for-update'),
  },

  tasks: {
    create: (input: CreateTaskInput): Promise<number> =>
      typedInvoke('task:create', input).then((task) => task.id),

    list: (filter?: TaskFilter): Promise<Task[]> =>
      typedInvoke('task:list', filter),

    update: (taskId: number, input: UpdateTaskInput): Promise<Task> =>
      typedInvoke('task:update', taskId, input),

    cancel: (taskId: number): Promise<void> =>
      typedInvoke('task:cancel', taskId),

    reorder: (taskId: number, direction: 'up' | 'down'): Promise<Task> =>
      typedInvoke('task:reorder', taskId, direction),

    onChanged: (cb: (event: TaskChangeEvent) => void): (() => void) =>
      typedListen('task:changed', cb),
  },

  preferences: {
    get: (key: string): Promise<string | null> =>
      typedInvoke('preferences:get', key),

    set: (key: string, value: string): Promise<void> =>
      typedInvoke('preferences:set', key, value),

    getSleepStatus: (): Promise<{ enabled: boolean; blocking: boolean }> =>
      typedInvoke('preferences:get-sleep-status'),

    setPreventSleep: (enabled: boolean): Promise<void> =>
      typedInvoke('preferences:set-prevent-sleep', enabled),
  },

  commits: {
    getDailyStats: (date?: string): Promise<DailyCommitStats> =>
      typedInvoke('commits:get-daily-stats', date),

    getHeatmap: (days?: number): Promise<CommitHeatmapEntry[]> =>
      typedInvoke('commits:get-heatmap', days),

    getStreaks: (): Promise<CommitStreakInfo> =>
      typedInvoke('commits:get-streaks'),

    getCadence: (date?: string): Promise<CommitCadenceInfo> =>
      typedInvoke('commits:get-cadence', date),

    getWeeklyTrend: (): Promise<CommitWeeklyTrend> =>
      typedInvoke('commits:get-weekly-trend'),

    refresh: (): Promise<void> =>
      typedInvoke('commits:refresh'),

    onUpdated: (cb: () => void): (() => void) =>
      typedListen('commits:updated', cb),
  },

  files: {
    list: (cwd: string): Promise<FileListResult> =>
      typedInvoke('files:list', cwd),

    read: (cwd: string, relativePath: string): Promise<FileReadResult> =>
      typedInvoke('files:read', cwd, relativePath),

    write: (cwd: string, relativePath: string, content: string): Promise<void> =>
      typedInvoke('files:write', cwd, relativePath, content),
  },

  slashCommands: {
    scan: (cwd: string): Promise<SlashCommandEntry[]> =>
      typedInvoke('slash-commands:scan', cwd),
  },

  snippets: {
    scan: (cwd: string): Promise<SnippetEntry[]> =>
      typedInvoke('snippets:scan', cwd),
    create: (scope: 'user' | 'project', cwd: string): Promise<string> =>
      typedInvoke('snippets:create', scope, cwd),
    delete: (filePath: string): Promise<void> =>
      typedInvoke('snippets:delete', filePath),
    openFolder: (scope: 'user' | 'project', cwd: string): Promise<void> =>
      typedInvoke('snippets:open-folder', scope, cwd),
  },

  tokens: {
    getSessionUsage: (claudeSessionId: string): Promise<SessionTokenUsage> =>
      typedInvoke('tokens:get-session-usage', claudeSessionId),

    getDailyUsage: (date?: string): Promise<DailyTokenUsage> =>
      typedInvoke('tokens:get-daily-usage', date),

    getModelBreakdown: (days?: number): Promise<ModelTokenBreakdown[]> =>
      typedInvoke('tokens:get-model-breakdown', days),

    getWeeklyTrend: (): Promise<TokenWeeklyTrend> =>
      typedInvoke('tokens:get-weekly-trend'),

    getHeatmap: (days?: number): Promise<TokenHeatmapEntry[]> =>
      typedInvoke('tokens:get-heatmap', days),

    refresh: (): Promise<void> =>
      typedInvoke('tokens:refresh'),

    onUpdated: (cb: () => void): (() => void) =>
      typedListen('tokens:updated', cb),
  },

  git: {
    getStatus: (cwd: string): Promise<GitStatusResult> =>
      typedInvoke('git:status', cwd),

    getDiffContent: (cwd: string, filePath: string): Promise<GitDiffContent> =>
      typedInvoke('git:diff-content', cwd, filePath),

    getAllStatuses: (): Promise<GitStatusResult[]> =>
      typedInvoke('git:all-statuses'),

    getGraphLog: (repoPath: string, limit?: number, offset?: number): Promise<CommitGraphResult> =>
      typedInvoke('git:graph-log', repoPath, limit, offset),

    getTrackedRepos: (): Promise<string[]> =>
      typedInvoke('git:tracked-repos'),

    getCommitFiles: (repoPath: string, commitHash: string): Promise<CommitFileEntry[]> =>
      typedInvoke('git:commit-files', repoPath, commitHash),

    getCommitFileDiff: (repoPath: string, commitHash: string, filePath: string): Promise<GitDiffContent> =>
      typedInvoke('git:commit-file-diff', repoPath, commitHash, filePath),

    stageFile: (repoRoot: string, filePath: string): Promise<void> =>
      typedInvoke('git:stage-file', repoRoot, filePath),

    unstageFile: (repoRoot: string, filePath: string): Promise<void> =>
      typedInvoke('git:unstage-file', repoRoot, filePath),

    discardFile: (repoRoot: string, filePath: string, isUntracked: boolean): Promise<void> =>
      typedInvoke('git:discard-file', repoRoot, filePath, isUntracked),

    stageAll: (repoRoot: string): Promise<void> =>
      typedInvoke('git:stage-all', repoRoot),

    unstageAll: (repoRoot: string): Promise<void> =>
      typedInvoke('git:unstage-all', repoRoot),

    discardAll: (repoRoot: string): Promise<void> =>
      typedInvoke('git:discard-all', repoRoot),

    onStatusChanged: (cb: () => void): (() => void) =>
      typedListen('git:status-changed', cb),
  },

  search: {
    start: (request: FileSearchRequest): Promise<string> =>
      typedInvoke('search:start', request),

    cancel: (searchId: string): Promise<void> =>
      typedInvoke('search:cancel', searchId),

    onEvent: (cb: (event: SearchEvent) => void): (() => void) =>
      typedListen('search:event', cb),
  },

  devtools: {
    onQuery: (
      cb: (
        requestId: string,
        type: string,
        params: Record<string, unknown>,
      ) => void,
    ): void => {
      typedListen('devtools:query', cb);
    },

    sendResponse: (requestId: string, data: unknown): void => {
      ipcRenderer.send(`devtools:response:${requestId}`, data);
    },
  },
});
