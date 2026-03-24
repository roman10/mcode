import { ipcMain } from 'electron';
import type { IpcInvokeContract, IpcInvokeHandler, IpcSendContract, IpcSendHandler } from '../shared/ipc-contract';

/** Type-safe wrapper for ipcMain.handle — channel names and parameter types are checked against the contract. */
export function typedHandle<K extends keyof IpcInvokeContract>(
  channel: K,
  handler: IpcInvokeHandler<K>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ipcMain.handle(channel, (_event, ...args: any[]) =>
    handler(...(args as IpcInvokeContract[K]['params'])),
  );
}

/** Type-safe wrapper for ipcMain.on — channel names and parameter types are checked against the contract. */
export function typedOn<K extends keyof IpcSendContract>(
  channel: K,
  handler: IpcSendHandler<K>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ipcMain.on(channel, (_event, ...args: any[]) =>
    handler(...(args as IpcSendContract[K]['params'])),
  );
}
