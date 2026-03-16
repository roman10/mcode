import { contextBridge, ipcRenderer } from 'electron';
import type {
  LayoutStateSnapshot,
  PtyExitPayload,
  SessionInfo,
  SessionStatus,
  SessionCreateInput,
} from '../shared/types';

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

    onStatusChange: (
      cb: (sessionId: string, status: SessionStatus) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        sessionId: string,
        status: SessionStatus,
      ): void => cb(sessionId, status);
      ipcRenderer.on('session:status-change', handler);
      return () =>
        ipcRenderer.removeListener('session:status-change', handler);
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
  },

  layout: {
    save: (mosaicTree: unknown, sidebarWidth?: number): Promise<void> =>
      ipcRenderer.invoke('layout:save', mosaicTree, sidebarWidth),

    load: (): Promise<LayoutStateSnapshot | null> =>
      ipcRenderer.invoke('layout:load'),
  },

  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),

    getPlatform: (): string => process.platform,

    selectDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke('app:select-directory'),

    onError: (cb: (error: string) => void): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        error: string,
      ): void => cb(error);
      ipcRenderer.on('app:error', handler);
      return () => ipcRenderer.removeListener('app:error', handler);
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
