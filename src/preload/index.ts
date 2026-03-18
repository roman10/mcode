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
  TaskFilter,
  TaskChangeEvent,
  AppCommand,
  DailyCommitStats,
  CommitHeatmapEntry,
  CommitStreakInfo,
  CommitCadenceInfo,
  CommitWeeklyTrend,
} from '../shared/types';

const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';

contextBridge.exposeInMainWorld('mcode', {
  pty: {
    write: (id: string, data: string): void => {
      ipcRenderer.send('pty:write', id, data);
    },

    resize: (id: string, cols: number, rows: number): void => {
      ipcRenderer.send('pty:resize', id, cols, rows);
    },

    kill: (id: string): Promise<void> => ipcRenderer.invoke('pty:kill', id),

    onData: (cb: (sessionId: string, data: string) => void): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        id: string,
        data: string,
      ): void => cb(id, data);
      ipcRenderer.on('pty:data', handler);
      return () => ipcRenderer.removeListener('pty:data', handler);
    },

    onExit: (
      cb: (sessionId: string, payload: PtyExitPayload) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        id: string,
        payload: PtyExitPayload,
      ): void => cb(id, payload);
      ipcRenderer.on('pty:exit', handler);
      return () => ipcRenderer.removeListener('pty:exit', handler);
    },

    getReplayData: (sessionId: string): Promise<string> =>
      ipcRenderer.invoke('pty:replay', sessionId),
  },

  sessions: {
    create: (input: SessionCreateInput): Promise<SessionInfo> =>
      ipcRenderer.invoke('session:create', input),

    list: (): Promise<SessionInfo[]> => ipcRenderer.invoke('session:list'),

    get: (sessionId: string): Promise<SessionInfo | null> =>
      ipcRenderer.invoke('session:get', sessionId),

    kill: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('session:kill', sessionId),

    setLabel: (sessionId: string, label: string): Promise<void> =>
      ipcRenderer.invoke('session:set-label', sessionId, label),

    setAutoLabel: (sessionId: string, label: string): Promise<void> =>
      ipcRenderer.invoke('session:set-auto-label', sessionId, label),

    setTerminalConfig: (sessionId: string, config: Record<string, unknown>): Promise<void> =>
      ipcRenderer.invoke('session:set-terminal-config', sessionId, config),

    clearAttention: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('session:clear-attention', sessionId),

    clearAllAttention: (): Promise<void> =>
      ipcRenderer.invoke('session:clear-all-attention'),

    resume: (sessionId: string): Promise<SessionInfo> =>
      ipcRenderer.invoke('session:resume', sessionId),

    listExternal: (limit?: number): Promise<ExternalSessionInfo[]> =>
      ipcRenderer.invoke('session:list-external', limit),

    importExternal: (claudeSessionId: string, cwd: string, label?: string): Promise<SessionInfo> =>
      ipcRenderer.invoke('session:import-external', claudeSessionId, cwd, label),

    onUpdated: (
      cb: (session: SessionInfo) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        session: SessionInfo,
      ): void => cb(session);
      ipcRenderer.on('session:updated', handler);
      return () => ipcRenderer.removeListener('session:updated', handler);
    },

    onCreated: (
      cb: (session: SessionInfo) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        session: SessionInfo,
      ): void => cb(session);
      ipcRenderer.on('session:created', handler);
      return () => ipcRenderer.removeListener('session:created', handler);
    },

    getLastDefaults: (): Promise<SessionDefaults | null> =>
      ipcRenderer.invoke('session:get-last-defaults'),

    delete: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('session:delete', sessionId),

    deleteAllEnded: (): Promise<string[]> =>
      ipcRenderer.invoke('session:delete-all-ended'),

    onDeleted: (
      cb: (sessionId: string) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        sessionId: string,
      ): void => cb(sessionId);
      ipcRenderer.on('session:deleted', handler);
      return () => ipcRenderer.removeListener('session:deleted', handler);
    },

    onDeletedBatch: (
      cb: (sessionIds: string[]) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        sessionIds: string[],
      ): void => cb(sessionIds);
      ipcRenderer.on('session:deleted-batch', handler);
      return () => ipcRenderer.removeListener('session:deleted-batch', handler);
    },
  },

  hooks: {
    getRuntime: (): Promise<HookRuntimeInfo> =>
      ipcRenderer.invoke('hooks:get-runtime'),

    onEvent: (cb: (event: HookEvent) => void): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        event: HookEvent,
      ): void => cb(event);
      ipcRenderer.on('hook:event', handler);
      return () => ipcRenderer.removeListener('hook:event', handler);
    },

    getRecent: (sessionId: string, limit?: number): Promise<HookEvent[]> =>
      ipcRenderer.invoke('hooks:get-recent', sessionId, limit ?? 50),

    getRecentAll: (limit?: number): Promise<HookEvent[]> =>
      ipcRenderer.invoke('hooks:get-recent-all', limit ?? 200),
  },

  layout: {
    save: (mosaicTree: unknown, sidebarWidth?: number, sidebarCollapsed?: boolean): Promise<void> =>
      ipcRenderer.invoke('layout:save', mosaicTree, sidebarWidth, sidebarCollapsed),

    load: (): Promise<LayoutStateSnapshot | null> =>
      ipcRenderer.invoke('layout:load'),
  },

  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),

    getPlatform: (): string => process.platform,

    getHomeDir: (): string => homeDir,

    selectDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke('app:select-directory'),

    setDockBadge: (text: string): void => {
      ipcRenderer.send('app:set-dock-badge', text);
    },

    getPathForFile: (file: File): string => webUtils.getPathForFile(file),

    onError: (cb: (error: string) => void): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        error: string,
      ): void => cb(error);
      ipcRenderer.on('app:error', handler);
      return () => ipcRenderer.removeListener('app:error', handler);
    },

    onCommand: (cb: (command: AppCommand) => void): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        command: AppCommand,
      ): void => cb(command);
      ipcRenderer.on('app:command', handler);
      return () => ipcRenderer.removeListener('app:command', handler);
    },
  },

  tasks: {
    create: (input: CreateTaskInput): Promise<number> =>
      ipcRenderer.invoke('task:create', input).then((task: Task) => task.id),

    list: (filter?: TaskFilter): Promise<Task[]> =>
      ipcRenderer.invoke('task:list', filter),

    cancel: (taskId: number): Promise<void> =>
      ipcRenderer.invoke('task:cancel', taskId),

    onChanged: (cb: (event: TaskChangeEvent) => void): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        event: TaskChangeEvent,
      ): void => cb(event);
      ipcRenderer.on('task:changed', handler);
      return () => ipcRenderer.removeListener('task:changed', handler);
    },
  },

  preferences: {
    get: (key: string): Promise<string | null> =>
      ipcRenderer.invoke('preferences:get', key),

    set: (key: string, value: string): Promise<void> =>
      ipcRenderer.invoke('preferences:set', key, value),

    getSleepStatus: (): Promise<{ enabled: boolean; blocking: boolean }> =>
      ipcRenderer.invoke('preferences:get-sleep-status'),

    setPreventSleep: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('preferences:set-prevent-sleep', enabled),
  },

  commits: {
    getDailyStats: (date?: string): Promise<DailyCommitStats> =>
      ipcRenderer.invoke('commits:get-daily-stats', date),

    getHeatmap: (days?: number): Promise<CommitHeatmapEntry[]> =>
      ipcRenderer.invoke('commits:get-heatmap', days),

    getStreaks: (): Promise<CommitStreakInfo> =>
      ipcRenderer.invoke('commits:get-streaks'),

    getCadence: (date?: string): Promise<CommitCadenceInfo> =>
      ipcRenderer.invoke('commits:get-cadence', date),

    getWeeklyTrend: (): Promise<CommitWeeklyTrend> =>
      ipcRenderer.invoke('commits:get-weekly-trend'),

    refresh: (): Promise<void> =>
      ipcRenderer.invoke('commits:refresh'),

    onUpdated: (cb: () => void): (() => void) => {
      const handler = (): void => cb();
      ipcRenderer.on('commits:updated', handler);
      return () => ipcRenderer.removeListener('commits:updated', handler);
    },
  },

  devtools: {
    onQuery: (
      cb: (
        requestId: string,
        type: string,
        params: Record<string, unknown>,
      ) => void,
    ): void => {
      ipcRenderer.on(
        'devtools:query',
        (
          _e: Electron.IpcRendererEvent,
          requestId: string,
          type: string,
          params: Record<string, unknown>,
        ) => cb(requestId, type, params),
      );
    },

    sendResponse: (requestId: string, data: unknown): void => {
      ipcRenderer.send(`devtools:response:${requestId}`, data);
    },
  },
});
