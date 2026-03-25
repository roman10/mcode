/**
 * Type-safe IPC contract between main process and renderer.
 *
 * All IPC channels must be declared here. Both main (ipcMain.handle/on)
 * and preload (ipcRenderer.invoke/send) derive their types from this contract,
 * so mismatched channel names or parameter types are caught at compile time.
 */
import type {
  AccountProfile,
  AppCommand,
  AuthStatusResult,
  CommitCadenceInfo,
  CommitFileEntry,
  CommitGraphResult,
  CommitHeatmapEntry,
  CommitStreakInfo,
  CommitWeeklyTrend,
  CreateTaskInput,
  DailyCommitStats,
  DailyInputStats,
  DailyTokenUsage,
  ExternalSessionInfo,
  FileListResult,
  FileReadResult,
  FileSearchRequest,
  GitDiffContent,
  GitStatusResult,
  HookEvent,
  HookRuntimeInfo,
  InputCadenceInfo,
  InputHeatmapEntry,
  InputWeeklyTrend,
  LayoutStateSnapshot,
  ModelTokenBreakdown,
  PtyExitPayload,
  SearchEvent,
  SessionCreateInput,
  SessionDefaults,
  SessionInfo,
  SessionTokenUsage,
  SlashCommandEntry,
  SnippetEntry,
  SubscriptionUsage,
  Task,
  TaskChangeEvent,
  TaskFilter,
  TokenHeatmapEntry,
  TokenWeeklyTrend,
  UpdateTaskInput,
} from './types';

// ---------------------------------------------------------------------------
// Invoke channels: renderer calls ipcRenderer.invoke, main handles with ipcMain.handle
// ---------------------------------------------------------------------------

export interface IpcInvokeContract {
  // --- PTY ---
  'pty:kill':                           { params: [id: string]; result: void };
  'pty:replay':                         { params: [sessionId: string]; result: string };

  // --- Sessions ---
  'session:create':                     { params: [input: SessionCreateInput]; result: SessionInfo };
  'session:list':                       { params: []; result: SessionInfo[] };
  'session:get':                        { params: [sessionId: string]; result: SessionInfo | null };
  'session:kill':                       { params: [sessionId: string]; result: void };
  'session:delete':                     { params: [sessionId: string]; result: void };
  'session:delete-all-ended':           { params: []; result: string[] };
  'session:delete-batch':               { params: [sessionIds: string[]]; result: string[] };
  'session:get-last-defaults':          { params: []; result: SessionDefaults | null };
  'session:set-label':                  { params: [sessionId: string, label: string]; result: void };
  'session:set-auto-label':             { params: [sessionId: string, label: string]; result: void };
  'session:set-terminal-config':        { params: [sessionId: string, config: Record<string, unknown>]; result: void };
  'session:clear-attention':            { params: [sessionId: string]; result: void };
  'session:clear-all-attention':        { params: []; result: void };
  'session:resume':                     { params: [opts: { sessionId: string; accountId?: string }]; result: SessionInfo };
  'session:list-external':              { params: [limit?: number]; result: ExternalSessionInfo[] };
  'session:import-external':            { params: [claudeSessionId: string, cwd: string, label?: string]; result: SessionInfo };

  // --- Layout ---
  'layout:save':                        { params: [mosaicTree: unknown, sidebarWidth?: number, sidebarCollapsed?: boolean, activeSidebarTab?: string, terminalPanelState?: unknown]; result: void };
  'layout:load':                        { params: []; result: LayoutStateSnapshot | null };

  // --- App ---
  'app:get-version':                    { params: []; result: string };
  'app:select-directory':               { params: []; result: string | null };
  'app:check-for-update':               { params: []; result: void };
  'app:open-update-page':               { params: []; result: void };

  // --- Tasks ---
  'task:create':                        { params: [input: CreateTaskInput]; result: Task };
  'task:list':                          { params: [filter?: TaskFilter]; result: Task[] };
  'task:update':                        { params: [taskId: number, input: UpdateTaskInput]; result: Task };
  'task:cancel':                        { params: [taskId: number]; result: void };
  'task:reorder':                       { params: [taskId: number, direction: 'up' | 'down']; result: Task };

  // --- Tokens ---
  'tokens:get-session-usage':           { params: [claudeSessionId: string]; result: SessionTokenUsage };
  'tokens:get-daily-usage':             { params: [date?: string]; result: DailyTokenUsage };
  'tokens:get-model-breakdown':         { params: [days?: number]; result: ModelTokenBreakdown[] };
  'tokens:get-weekly-trend':            { params: []; result: TokenWeeklyTrend };
  'tokens:get-heatmap':                 { params: [days?: number]; result: TokenHeatmapEntry[] };
  'tokens:refresh':                     { params: []; result: void };

  // --- Input ---
  'input:get-daily-stats':              { params: [date?: string]; result: DailyInputStats };
  'input:get-heatmap':                  { params: [days?: number]; result: InputHeatmapEntry[] };
  'input:get-weekly-trend':             { params: []; result: InputWeeklyTrend };
  'input:get-cadence':                  { params: [date?: string]; result: InputCadenceInfo };

  // --- Commits ---
  'commits:get-daily-stats':            { params: [date?: string]; result: DailyCommitStats };
  'commits:get-heatmap':                { params: [days?: number]; result: CommitHeatmapEntry[] };
  'commits:get-streaks':                { params: []; result: CommitStreakInfo };
  'commits:get-cadence':                { params: [date?: string]; result: CommitCadenceInfo };
  'commits:get-weekly-trend':           { params: []; result: CommitWeeklyTrend };
  'commits:refresh':                    { params: []; result: void };

  // --- Git ---
  'git:status':                         { params: [cwd: string]; result: GitStatusResult };
  'git:diff-content':                   { params: [cwd: string, filePath: string]; result: GitDiffContent };
  'git:all-statuses':                   { params: []; result: GitStatusResult[] };
  'git:graph-log':                      { params: [repoPath: string, limit?: number, offset?: number]; result: CommitGraphResult };
  'git:tracked-repos':                  { params: []; result: string[] };
  'git:commit-files':                   { params: [repoPath: string, commitHash: string]; result: CommitFileEntry[] };
  'git:commit-file-diff':               { params: [repoPath: string, commitHash: string, filePath: string]; result: GitDiffContent };
  'git:stage-file':                     { params: [repoRoot: string, filePath: string]; result: void };
  'git:unstage-file':                   { params: [repoRoot: string, filePath: string]; result: void };
  'git:discard-file':                   { params: [repoRoot: string, filePath: string, isUntracked: boolean]; result: void };
  'git:stage-all':                      { params: [repoRoot: string]; result: void };
  'git:unstage-all':                    { params: [repoRoot: string]; result: void };
  'git:discard-all':                    { params: [repoRoot: string]; result: void };

  // --- Preferences ---
  'preferences:get':                    { params: [key: string]; result: string | null };
  'preferences:set':                    { params: [key: string, value: string]; result: void };
  'preferences:get-sleep-status':       { params: []; result: { enabled: boolean; blocking: boolean } };
  'preferences:set-prevent-sleep':      { params: [enabled: boolean]; result: void };

  // --- Hooks ---
  'hooks:get-runtime':                  { params: []; result: HookRuntimeInfo };
  'hooks:get-recent':                   { params: [sessionId: string, limit?: number]; result: HookEvent[] };
  'hooks:get-recent-all':               { params: [limit?: number]; result: HookEvent[] };
  'hooks:clear-all':                    { params: []; result: void };

  // --- Accounts ---
  'account:list':                       { params: []; result: AccountProfile[] };
  'account:create':                     { params: [name?: string]; result: AccountProfile };
  'account:rename':                     { params: [accountId: string, name: string]; result: void };
  'account:delete':                     { params: [accountId: string]; result: void };
  'account:get-auth-status':            { params: [accountId: string]; result: AuthStatusResult };
  'account:check-cli-installed':        { params: []; result: AuthStatusResult };
  'account:open-auth-terminal':         { params: [accountId: string]; result: string };
  'account:get-subscription-usage':     { params: [accountId: string, forceRefresh?: boolean]; result: SubscriptionUsage | null };

  // --- Files ---
  'files:list':                         { params: [cwd: string]; result: FileListResult };
  'files:read':                         { params: [cwd: string, relativePath: string]; result: FileReadResult };
  'files:write':                        { params: [cwd: string, relativePath: string, content: string]; result: void };

  // --- Search ---
  'search:start':                       { params: [request: FileSearchRequest]; result: string };
  'search:cancel':                      { params: [searchId: string]; result: void };

  // --- Slash Commands ---
  'slash-commands:scan':                { params: [cwd: string]; result: SlashCommandEntry[] };

  // --- Snippets ---
  'snippets:scan':                      { params: [cwd: string]; result: SnippetEntry[] };
  'snippets:create':                    { params: [scope: 'user' | 'project', cwd: string]; result: string };
  'snippets:delete':                    { params: [filePath: string]; result: void };
  'snippets:open-folder':              { params: [scope: 'user' | 'project', cwd: string]; result: void };
}

// ---------------------------------------------------------------------------
// Send channels: renderer fires ipcRenderer.send, main listens with ipcMain.on
// (fire-and-forget, no response)
// ---------------------------------------------------------------------------

export interface IpcSendContract {
  'pty:write':                          { params: [id: string, data: string] };
  'pty:resize':                         { params: [id: string, cols: number, rows: number] };
  'app:set-dock-badge':                 { params: [text: string] };
}

// ---------------------------------------------------------------------------
// Push channels: main fires webContents.send, renderer listens with ipcRenderer.on
// (main → renderer notifications)
// ---------------------------------------------------------------------------

export interface IpcPushContract {
  'pty:data':                           { params: [sessionId: string, data: string] };
  'pty:exit':                           { params: [sessionId: string, payload: PtyExitPayload] };
  'session:created':                    { params: [session: SessionInfo] };
  'session:updated':                    { params: [session: SessionInfo] };
  'session:deleted':                    { params: [sessionId: string] };
  'session:deleted-batch':              { params: [sessionIds: string[]] };
  'hook:event':                         { params: [event: HookEvent] };
  'task:changed':                       { params: [event: TaskChangeEvent] };
  'commits:updated':                    { params: [] };
  'tokens:updated':                     { params: [] };
  'git:status-changed':                 { params: [] };
  'search:event':                       { params: [event: SearchEvent] };
  'app:command':                        { params: [command: AppCommand] };
  'app:error':                          { params: [error: string] };
  'app:update-available':               { params: [info: { version: string }] };
  'devtools:query':                     { params: [requestId: string, type: string, params: Record<string, unknown>] };
}

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
