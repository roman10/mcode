import { contextBridge, ipcRenderer } from 'electron';
import type { PtySpawnOptions, PtyExitPayload } from '../shared/types';

contextBridge.exposeInMainWorld('mcode', {
  pty: {
    spawn: (opts: PtySpawnOptions): Promise<string> =>
      ipcRenderer.invoke('pty:spawn', opts),

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
  },
});
