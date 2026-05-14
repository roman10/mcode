import type { MosaicNode } from 'react-mosaic-component';
import type { AgentSessionType } from './session-agents';
import type {
  CommitHeatmapEntry, CommitStreakInfo, CommitCadenceInfo, DailyCommitStats,
} from './types-commits';
import type {
  SessionTokenUsage, DailyTokenUsage, ModelTokenBreakdown, TokenHeatmapEntry,
} from './types-tokens';
import type {
  DailyInputStats, InputHeatmapEntry, InputCadenceInfo, PromptHistoryEntry,
} from './types-input';
import type {
  GitStatusResult, GitDiffContent, CommitGraphResult, CommitFileEntry,
} from './types-git';
import type {
  Task, CreateTaskInput, UpdateTaskInput, TaskFilter, TaskChangeEvent,
} from './types-tasks';
import type {
  TodoItem, CreateTodoInput, UpdateTodoInput,
} from './types-todos';
import type {
  AccountProfile, AccountProfileWithProviders, AuthStatusResult, CliAuthStatus,
} from './types-accounts';
import type { QuotaSnapshot } from './types-quotas';
import type { PtyExitPayload, PtyReplayDelta } from './types-pty';
import type {
  SessionInfo, SessionCreateInput, SessionDefaults, ExternalSessionInfo, TerminalConfig,
} from './types-sessions';
import type { SidebarTab, LayoutStateSnapshot } from './types-layout';
import type { AppCommand } from './types-commands';
import type { HookEvent, HookRuntimeInfo } from './types-hooks';
import type { SlashCommandEntry, SnippetEntry } from './types-snippets';
import type { FileListResult, FileReadResult } from './types-files';
import type { FileSearchRequest, SearchEvent } from './types-search';
import type { ShellHistoryEntry } from './types-shell';
import type { MemorySnapshot } from './types-devtools';

/**
 * Runtime API surface exposed to the renderer via the preload bridge.
 * Each top-level key maps to a domain; methods correspond to IPC channels
 * declared in `ipc-contract-*.ts`. The shape here drives `src/preload/index.ts`.
 */
export interface MCodeAPI {
  accounts: {
    list(): Promise<AccountProfileWithProviders[]>;
    create(name?: string): Promise<AccountProfile>;
    rename(accountId: string, name: string): Promise<void>;
    delete(accountId: string): Promise<void>;
    getAuthStatus(accountId: string, sessionType?: string): Promise<AuthStatusResult>;
    checkCliInstalled(sessionType?: string): Promise<CliAuthStatus>;
    openAuthTerminal(accountId: string, sessionType?: string): Promise<string>; // returns sessionId of auth terminal
  };

  quota: {
    list(forceRefresh?: boolean): Promise<QuotaSnapshot[]>;
  };

  pty: {
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    kill(sessionId: string): Promise<void>;
    onData(callback: (sessionId: string, data: string) => void): () => void;
    onExit(
      callback: (sessionId: string, payload: PtyExitPayload) => void,
    ): () => void;
    getReplayData(sessionId: string): Promise<string>;
    getReplaySince(sessionId: string, offset: number): Promise<PtyReplayDelta>;
  };

  sessions: {
    create(input: SessionCreateInput): Promise<SessionInfo>;
    list(): Promise<SessionInfo[]>;
    get(sessionId: string): Promise<SessionInfo | null>;
    kill(sessionId: string): Promise<void>;
    setLabel(sessionId: string, label: string): Promise<void>;
    setAutoLabel(sessionId: string, label: string): Promise<void>;
    setAutoClose(sessionId: string, value: boolean): Promise<void>;
    setTerminalConfig(sessionId: string, config: Partial<TerminalConfig>): Promise<void>;
    clearAttention(sessionId: string): Promise<void>;
    clearAllAttention(): Promise<void>;
    resume(sessionId: string, accountId?: string): Promise<SessionInfo>;
    fork(
      sessionId: string,
      targetCli: 'claude' | 'codex' | 'gemini' | 'copilot',
      mode: 'compacted' | 'full',
    ): Promise<SessionInfo>;
    forkPreview(sessionId: string): Promise<{ summary: string; usedCli: string }>;
    listExternal(limit?: number): Promise<ExternalSessionInfo[]>;
    importExternal(claudeSessionId: string, cwd: string, label?: string): Promise<SessionInfo>;
    onUpdated(callback: (session: SessionInfo) => void): () => void;
    onCreated(callback: (session: SessionInfo) => void): () => void;
    getLastDefaults(sessionType?: string): Promise<SessionDefaults | null>;
    delete(sessionId: string): Promise<void>;
    deleteAllEnded(): Promise<string[]>;
    deleteBatch(sessionIds: string[]): Promise<string[]>;
    onDeleted(callback: (sessionId: string) => void): () => void;
    onDeletedBatch(callback: (sessionIds: string[]) => void): () => void;
  };

  hooks: {
    getRuntime(): Promise<HookRuntimeInfo>;
    onEvent(callback: (event: HookEvent) => void): () => void;
    getRecent(sessionId: string, limit?: number): Promise<HookEvent[]>;
    getRecentAll(limit?: number): Promise<HookEvent[]>;
    clearAll(): Promise<void>;
  };

  layout: {
    save(
      mosaicTree: MosaicNode<string> | null,
      sidebarWidth?: number,
      sidebarCollapsed?: boolean,
      activeSidebarTab?: SidebarTab,
      terminalPanelState?: unknown,
    ): Promise<void>;
    load(): Promise<LayoutStateSnapshot | null>;
  };

  app: {
    getVersion(): Promise<string>;
    getPlatform(): string;
    getHomeDir(): string;
    selectDirectory(): Promise<string | null>;
    getPathForFile(file: File): string;
    onError(callback: (error: string) => void): () => void;
    onCommand(callback: (command: AppCommand) => void): () => void;
    onWake(callback: () => void): () => void;
    onUpdateAvailable(
      callback: (info: { version: string }) => void,
    ): () => void;
    onUpdateDownloadProgress(
      callback: (info: { percent: number }) => void,
    ): () => void;
    onUpdateDownloaded(
      callback: (info: { version: string }) => void,
    ): () => void;
    onUpdateError(
      callback: (info: { message: string }) => void,
    ): () => void;
    openUpdatePage(): Promise<void>;
    checkForUpdate(): Promise<void>;
    downloadUpdate(): Promise<void>;
    installUpdate(): Promise<void>;
    getMemorySnapshot(): Promise<MemorySnapshot>;
  };

  preferences: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    getSleepStatus(): Promise<{ enabled: boolean; blocking: boolean }>;
    setPreventSleep(enabled: boolean): Promise<void>;
  };

  tasks: {
    create(input: CreateTaskInput): Promise<number>;
    list(filter?: TaskFilter): Promise<Task[]>;
    update(taskId: number, input: UpdateTaskInput): Promise<Task>;
    cancel(taskId: number): Promise<void>;
    reorder(taskId: number, direction: 'up' | 'down'): Promise<Task>;
    onChanged(callback: (event: TaskChangeEvent) => void): () => void;
  };

  commits: {
    getDailyStats(date?: string, provider?: string): Promise<DailyCommitStats>;
    getHeatmap(startDate: string, endDate: string, provider?: string, fillEmptyDays?: boolean): Promise<CommitHeatmapEntry[]>;
    getStreaks(provider?: string): Promise<CommitStreakInfo>;
    getCadence(date?: string, provider?: string): Promise<CommitCadenceInfo>;
    refresh(): Promise<void>;
    forceRescan(): Promise<void>;
    onUpdated(callback: () => void): () => void;
  };

  files: {
    list(cwd: string): Promise<FileListResult>;
    read(cwd: string, relativePath: string): Promise<FileReadResult>;
    write(cwd: string, relativePath: string, content: string): Promise<void>;
  };

  tokens: {
    getSessionUsage(sessionId: string): Promise<SessionTokenUsage>;
    getDailyUsage(date?: string, provider?: string): Promise<DailyTokenUsage>;
    getModelBreakdown(days?: number, provider?: string): Promise<ModelTokenBreakdown[]>;
    getHeatmap(startDate: string, endDate: string, provider?: string, fillEmptyDays?: boolean): Promise<TokenHeatmapEntry[]>;
    refresh(): Promise<void>;
    onUpdated(callback: () => void): () => void;
  };

  input: {
    getDailyStats(date?: string, provider?: string): Promise<DailyInputStats>;
    getHeatmap(startDate: string, endDate: string, provider?: string, fillEmptyDays?: boolean): Promise<InputHeatmapEntry[]>;
    getCadence(date?: string, provider?: string): Promise<InputCadenceInfo>;
  };

  promptHistory: {
    search(query: string, limit?: number): Promise<PromptHistoryEntry[]>;
    recent(limit?: number): Promise<PromptHistoryEntry[]>;
    delete(id: number): Promise<void>;
    togglePin(id: number): Promise<void>;
  };

  shellHistory: {
    recent(limit?: number, query?: string): Promise<ShellHistoryEntry[]>;
  };

  git: {
    getStatus(cwd: string): Promise<GitStatusResult>;
    getDiffContent(cwd: string, filePath: string): Promise<GitDiffContent>;
    getAllStatuses(): Promise<GitStatusResult[]>;
    getGraphLog(repoPath: string, limit?: number, offset?: number): Promise<CommitGraphResult>;
    getTrackedRepos(): Promise<string[]>;
    getCommitFiles(repoPath: string, commitHash: string): Promise<CommitFileEntry[]>;
    getCommitFileDiff(repoPath: string, commitHash: string, filePath: string): Promise<GitDiffContent>;
    stageFile(repoRoot: string, filePath: string): Promise<void>;
    unstageFile(repoRoot: string, filePath: string): Promise<void>;
    discardFile(repoRoot: string, filePath: string, isUntracked: boolean): Promise<void>;
    stageAll(repoRoot: string): Promise<void>;
    unstageAll(repoRoot: string): Promise<void>;
    discardAll(repoRoot: string): Promise<void>;
    onStatusChanged(callback: () => void): () => void;
  };

  slashCommands: {
    scan(sessionType: AgentSessionType, cwd: string): Promise<SlashCommandEntry[]>;
  };

  snippets: {
    scan(cwd: string): Promise<SnippetEntry[]>;
    create(scope: 'user' | 'project', cwd: string): Promise<string>;
    createFromText(scope: 'user' | 'project', cwd: string, text: string): Promise<string>;
    delete(filePath: string): Promise<void>;
    openFolder(scope: 'user' | 'project', cwd: string): Promise<void>;
  };

  todos: {
    scan(cwd: string): Promise<TodoItem[]>;
    create(cwd: string, input: CreateTodoInput): Promise<TodoItem>;
    update(cwd: string, index: number, input: UpdateTodoInput): Promise<TodoItem>;
    delete(cwd: string, index: number): Promise<void>;
    reorder(cwd: string, index: number, direction: 'up' | 'down'): Promise<void>;
  };

  search: {
    start(request: FileSearchRequest): Promise<string>;  // returns searchId
    cancel(searchId: string): Promise<void>;
    onEvent(callback: (event: SearchEvent) => void): () => void;
  };

  devtools: {
    onQuery(
      cb: (
        requestId: string,
        type: string,
        params: Record<string, unknown>,
      ) => void,
    ): void;
    sendResponse(requestId: string, data: unknown): void;
  };
}
