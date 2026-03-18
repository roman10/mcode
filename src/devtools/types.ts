import type { BrowserWindow } from 'electron';
import type { PtyManager } from '../main/pty-manager';
import type { SessionManager } from '../main/session-manager';
import type { TaskQueue } from '../main/task-queue';
import type { HookRuntimeInfo } from '../shared/types';

export type { ConsoleEntry, HmrEvent } from '../shared/types';

export interface McpServerContext {
  mainWindow: BrowserWindow;
  ptyManager: PtyManager;
  sessionManager: SessionManager;
  taskQueue: TaskQueue;
  getHookRuntimeInfo: () => HookRuntimeInfo;
}
