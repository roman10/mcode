import type { BrowserWindow } from 'electron';
import type { PtyManager } from '../main/pty-manager';
import type { SessionManager } from '../main/session-manager';

export type { ConsoleEntry, HmrEvent } from '../shared/types';

export interface McpServerContext {
  mainWindow: BrowserWindow;
  ptyManager: PtyManager;
  sessionManager: SessionManager;
}
