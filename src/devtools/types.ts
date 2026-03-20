import type { BrowserWindow } from 'electron';
import type { PtyManager } from '../main/pty-manager';
import type { SessionManager } from '../main/session-manager';
import type { TaskQueue } from '../main/task-queue';
import type { CommitTracker } from '../main/commit-tracker';
import type { GitChangesService } from '../main/git-changes';
import type { TokenTracker } from '../main/token-tracker';
import type { SleepBlocker } from '../main/sleep-blocker';
import type { FileLister } from '../main/file-lister';
import type { HookRuntimeInfo } from '../shared/types';

export type { ConsoleEntry, HmrEvent } from '../shared/types';

export interface McpServerContext {
  mainWindow: BrowserWindow;
  ptyManager: PtyManager;
  sessionManager: SessionManager;
  taskQueue: TaskQueue;
  commitTracker: CommitTracker;
  gitChangesService: GitChangesService;
  tokenTracker: TokenTracker;
  getHookRuntimeInfo: () => HookRuntimeInfo;
  sleepBlocker: SleepBlocker;
  fileLister: FileLister;
}
