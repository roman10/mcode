/**
 * Type-safe IPC contract between main process and renderer.
 *
 * All IPC channels must be declared here. Both main (ipcMain.handle/on)
 * and preload (ipcRenderer.invoke/send) derive their types from this contract,
 * so mismatched channel names or parameter types are caught at compile time.
 *
 * Channel definitions are split into domain-specific files; this module
 * re-exports the combined types so no consumer imports need to change.
 */

// Re-export all domain contracts so consumers can import individual pieces if desired
export * from './ipc-contract-pty';
export * from './ipc-contract-session';
export * from './ipc-contract-trackers';
export * from './ipc-contract-git';
export * from './ipc-contract-files';
export * from './ipc-contract-app';

import type { PtyInvokeContract, PtySendContract, PtyPushContract } from './ipc-contract-pty';
import type { SessionInvokeContract, SessionPushContract } from './ipc-contract-session';
import type { TrackersInvokeContract, TrackersPushContract } from './ipc-contract-trackers';
import type { GitInvokeContract, GitPushContract } from './ipc-contract-git';
import type { FilesInvokeContract, FilesPushContract } from './ipc-contract-files';
import type { AppInvokeContract, AppSendContract, AppPushContract } from './ipc-contract-app';

// ---------------------------------------------------------------------------
// Invoke channels: renderer calls ipcRenderer.invoke, main handles with ipcMain.handle
// ---------------------------------------------------------------------------

export type IpcInvokeContract =
  PtyInvokeContract &
  SessionInvokeContract &
  TrackersInvokeContract &
  GitInvokeContract &
  FilesInvokeContract &
  AppInvokeContract;

// ---------------------------------------------------------------------------
// Send channels: renderer fires ipcRenderer.send, main listens with ipcMain.on
// (fire-and-forget, no response)
// ---------------------------------------------------------------------------

export type IpcSendContract =
  PtySendContract &
  AppSendContract;

// ---------------------------------------------------------------------------
// Push channels: main fires webContents.send, renderer listens with ipcRenderer.on
// (main → renderer notifications)
// ---------------------------------------------------------------------------

export type IpcPushContract =
  PtyPushContract &
  SessionPushContract &
  TrackersPushContract &
  GitPushContract &
  FilesPushContract &
  AppPushContract;

// ---------------------------------------------------------------------------
// Typed helper types for main process and preload
// ---------------------------------------------------------------------------

/** Handler signature for ipcMain.handle — receives params, returns result */
export type IpcInvokeHandler<K extends keyof IpcInvokeContract> =
  (...args: IpcInvokeContract[K]['params']) =>
    IpcInvokeContract[K]['result'] | Promise<IpcInvokeContract[K]['result']>;

/** Handler signature for ipcMain.on — receives params, returns nothing */
export type IpcSendHandler<K extends keyof IpcSendContract> =
  (...args: IpcSendContract[K]['params']) => void;
