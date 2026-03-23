import type { MosaicNode } from 'react-mosaic-component';
import type { EffortLevel, PermissionMode } from './constants';

// --- Account Profiles ---

export interface AccountProfile {
  accountId: string;
  name: string;
  email: string | null;
  isDefault: boolean;
  homeDir: string | null; // null for default account (uses real ~/.claude/)
  createdAt: string;
  lastUsedAt: string | null;
}

// --- CLI / Auth Status ---

export type CliAuthStatus = 'ok' | 'cli-not-found' | 'not-authenticated';

export interface AuthStatusResult {
  status: CliAuthStatus;
  email?: string;
}

// --- Subscription Usage ---

export interface RateLimitWindow {
  utilization: number;     // 0–100 percent
  resetsAt: string | null; // ISO-8601 datetime, or null
}

export interface SubscriptionUsage {
  fiveHour: RateLimitWindow | null;
  sevenDay: RateLimitWindow | null;
  sevenDayOpus: RateLimitWindow | null; // null if not present in API response
  fetchedAt: string; // ISO-8601 timestamp
}

// --- Terminal Config ---

export interface TerminalConfig {
  scrollbackLines?: number; // undefined = use DEFAULT_SCROLLBACK_LINES
}

// --- Session ---

export type SessionType = 'claude' | 'terminal';
export type SessionStatus = 'starting' | 'active' | 'idle' | 'waiting' | 'detached' | 'ended';
export type SessionAttentionLevel = 'none' | 'info' | 'action';

export interface SessionInfo {
  sessionId: string;
  label: string;
  cwd: string;
  status: SessionStatus;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
  worktree: string | null;
  startedAt: string; // ISO 8601
  endedAt: string | null;

  claudeSessionId: string | null;
  lastTool: string | null;
  lastEventAt: string | null;
  attentionLevel: SessionAttentionLevel;
  attentionReason: string | null;
  hookMode: 'live' | 'fallback';
  sessionType: SessionType;
  terminalConfig: TerminalConfig;
  ephemeral: boolean;
  accountId: string | null;
}

export interface SessionCreateInput {
  cwd: string;
  label?: string;
  initialPrompt?: string;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
  worktree?: string;
  command?: string;
  args?: string[];
  sessionType?: SessionType;
  ephemeral?: boolean;
  accountId?: string;
}

export interface SessionDefaults {
  cwd: string;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
  accountId?: string;
}

// --- External (non-mcode) Claude Code sessions ---

export interface ExternalSessionInfo {
  claudeSessionId: string;
  startedAt: string; // ISO 8601
  slug: string;
  customTitle?: string; // meaningful title from Claude Code, when available
}

export type SidebarTab = 'sessions' | 'search' | 'changes' | 'commits' | 'tokens' | 'activity';
export type ViewMode = 'tiles' | 'kanban';

export interface LayoutStateSnapshot {
  mosaicTree: MosaicNode<string> | null;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  activeSidebarTab: SidebarTab;
}

// --- App Commands (menu accelerators → renderer) ---

export type AppCommand =
  | { command: 'new-session' }
  | { command: 'new-terminal' }
  | { command: 'focus-session-index'; index: number }
  | { command: 'focus-next-session' }
  | { command: 'focus-prev-session' }
  | { command: 'toggle-sidebar' }
  | { command: 'show-keyboard-shortcuts' }
  | { command: 'show-settings' }
  | { command: 'switch-sidebar-tab'; tab: SidebarTab }
  | { command: 'clear-all-attention' }
  | { command: 'close-all-tiles' }
  | { command: 'show-command-palette' }
  | { command: 'quick-open' }
  | { command: 'show-create-task' }
  | { command: 'set-view-mode'; mode: ViewMode }
  | { command: 'toggle-view-mode' }
  | { command: 'run-shell-command' }
  | { command: 'search-in-files' }
  | { command: 'open-snippets' };

// --- Slash Commands ---

export interface SlashCommandEntry {
  name: string; // e.g. "compact", "dr"
  description: string; // first line of .md file, or built-in description
  source: 'builtin' | 'user' | 'project';
}

// --- Prompt Snippets ---

export interface SnippetVariable {
  name: string;
  description?: string;
  default?: string;
}

export interface SnippetEntry {
  name: string;
  description: string;
  source: 'user' | 'project';
  variables: SnippetVariable[];
  body: string;
  filePath: string;
}

// --- File Search ---

export interface FileSearchMatch {
  path: string;        // relative to repo root
  line: number;
  column: number;
  matchLength: number;
  lineContent: string;
}

export interface FileSearchRequest {
  id: string;
  query: string;
  isRegex: boolean;
  caseSensitive: boolean;
  cwds: string[];      // session cwds to search across
  maxResults?: number;  // default 500
}

export type SearchEvent =
  | { type: 'progress'; searchId: string; repoPath: string; repoName: string; matches: FileSearchMatch[] }
  | { type: 'complete'; searchId: string; totalMatches: number; totalFiles: number; truncated: boolean; durationMs: number }
  | { type: 'error'; searchId: string; message: string };

// --- Files ---

export interface FileListResult {
  files: string[];
  isGitRepo: boolean;
}

export type FileReadResult =
  | { content: string; language: string }
  | { isBinary: true }
  | { isTooLarge: true };

// --- Hooks ---

export type HookRuntimeState = 'initializing' | 'ready' | 'degraded';

export interface HookRuntimeInfo {
  state: HookRuntimeState;
  port: number | null;
  warning: string | null;
}

export interface HookEvent {
  sessionId: string;
  claudeSessionId: string | null;
  hookEventName: string;
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  createdAt: string;
  payload: Record<string, unknown>;
  /** Session status after this event was processed. Undefined for pre-migration rows. */
  sessionStatus?: SessionStatus;
}

// --- Task Queue ---

export type TaskStatus = 'pending' | 'dispatched' | 'completed' | 'failed';

export interface PlanModeAction {
  exitPlanMode: boolean; // UI hint: true = proceed, false = revise
}

export interface Task {
  id: number;
  prompt: string;
  cwd: string;
  targetSessionId: string | null;
  sessionId: string | null;
  status: TaskStatus;
  priority: number;
  scheduledAt: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  maxRetries: number;
  error: string | null;
  planModeAction: PlanModeAction | null;
}

export interface CreateTaskInput {
  prompt: string;
  cwd: string;
  targetSessionId?: string;
  priority?: number;
  scheduledAt?: string;
  maxRetries?: number;
  planModeAction?: PlanModeAction;
}

export interface UpdateTaskInput {
  prompt?: string;
  priority?: number;
  scheduledAt?: string | null;
}

export interface TaskFilter {
  statuses?: TaskStatus[];
  targetSessionId?: string;
  limit?: number;
}

export type TaskChangeEvent =
  | { type: 'upsert'; task: Task }
  | { type: 'remove'; taskId: number }
  | { type: 'refresh' };

// --- PTY ---

export interface PtySpawnOptions {
  id: string;
  command: string;
  cwd: string;
  cols: number;
  rows: number;
  args?: string[];
  env?: Record<string, string>;
  onFirstData?: () => void;
  onExit?: (exitCode: number, signal?: number) => void;
}

export interface PtyExitPayload {
  code: number;
  signal?: number;
}

// --- Commit Tracking ---

export interface CommitRecord {
  id: number;
  repoPath: string;
  commitHash: string;
  commitMessage: string | null;
  commitType: string | null;
  authorName: string | null;
  authorEmail: string | null;
  isClaudeAssisted: boolean;
  committedAt: string;
  date: string;
  filesChanged: number | null;
  insertions: number | null;
  deletions: number | null;
}

export interface RepoCommitStats {
  repoPath: string;
  count: number;
  insertions: number;
  deletions: number;
}

export interface CommitTypeStats {
  type: string;
  count: number;
}

export interface DailyCommitStats {
  date: string;
  total: number;
  totalInsertions: number;
  totalDeletions: number;
  claudeAssisted: number;
  soloCount: number;
  byRepo: RepoCommitStats[];
  byType: CommitTypeStats[];
}

export interface CommitHeatmapEntry {
  date: string;
  count: number;
  insertions: number;
}

export interface CommitStreakInfo {
  current: number;
  longest: number;
}

export interface CommitCadenceInfo {
  avgMinutes: number | null;
  peakHour: string | null;
  commitsByHour: Record<string, number>;
}

export interface CommitWeeklyTrend {
  thisWeek: number;
  lastWeek: number;
  pctChange: number | null;
}

// --- Token Usage ---

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
}

export interface ModelUsageSummary {
  model: string;
  modelFamily: string;
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
}

export interface SessionTokenUsage {
  claudeSessionId: string;
  models: ModelUsageSummary[];
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
}

export interface DailyTokenUsage {
  date: string;
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
  byModel: ModelUsageSummary[];
  topSessions: Array<{
    claudeSessionId: string;
    label: string | null;
    estimatedCostUsd: number;
    outputTokens: number;
  }>;
}

export interface ModelTokenBreakdown {
  model: string;
  modelFamily: string;
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
  pctOfTotalCost: number;
}

export interface TokenWeeklyTrend {
  thisWeek: { outputTokens: number; estimatedCostUsd: number; messageCount: number };
  lastWeek: { outputTokens: number; estimatedCostUsd: number; messageCount: number };
  pctChange: number | null;
}

export interface TokenHeatmapEntry {
  date: string;
  outputTokens: number;
  estimatedCostUsd: number;
  messageCount: number;
}

// --- Git Changes ---

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

export interface GitChangedFile {
  path: string;           // relative to repo root
  status: GitFileStatus;
  oldPath?: string;       // for renamed files
}

export interface GitStatusResult {
  repoRoot: string;
  staged: GitChangedFile[];    // index area (X column in porcelain)
  unstaged: GitChangedFile[];  // worktree area (Y column in porcelain) + untracked
}

export type GitDiffContent =
  | { binary: false; originalContent: string; modifiedContent: string; language: string }
  | { binary: true };

// --- Git Commit Graph ---

export interface CommitGraphNode {
  hash: string;
  shortHash: string;
  parents: string[];
  message: string;
  authorName: string;
  authorEmail: string;
  committedAt: string; // ISO 8601
  refs: string[];      // branch/tag names pointing to this commit
  isClaudeAssisted: boolean;
  filesChanged: number | null;
  insertions: number | null;
  deletions: number | null;
}

export interface CommitGraphResult {
  repoRoot: string;
  commits: CommitGraphNode[];
  hasMore: boolean;
}

export interface CommitFileEntry {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  insertions: number;
  deletions: number;
}

// --- Devtools ---

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  timestamp: number;
  args: string[];
}

export interface HmrEvent {
  type: string;
  timestamp: number;
}

// --- IPC API ---

export interface MCodeAPI {
  accounts: {
    list(): Promise<AccountProfile[]>;
    create(name?: string): Promise<AccountProfile>;
    rename(accountId: string, name: string): Promise<void>;
    delete(accountId: string): Promise<void>;
    getAuthStatus(accountId: string): Promise<AuthStatusResult>;
    checkCliInstalled(): Promise<CliAuthStatus>;
    openAuthTerminal(accountId: string): Promise<string>; // returns sessionId of auth terminal
    getSubscriptionUsage(accountId: string): Promise<SubscriptionUsage | null>;
    invalidateSubscriptionCache(accountId: string): Promise<void>;
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
  };

  sessions: {
    create(input: SessionCreateInput): Promise<SessionInfo>;
    list(): Promise<SessionInfo[]>;
    get(sessionId: string): Promise<SessionInfo | null>;
    kill(sessionId: string): Promise<void>;
    setLabel(sessionId: string, label: string): Promise<void>;
    setAutoLabel(sessionId: string, label: string): Promise<void>;
    setTerminalConfig(sessionId: string, config: Partial<TerminalConfig>): Promise<void>;
    clearAttention(sessionId: string): Promise<void>;
    clearAllAttention(): Promise<void>;
    resume(sessionId: string, accountId?: string): Promise<SessionInfo>;
    listExternal(limit?: number): Promise<ExternalSessionInfo[]>;
    importExternal(claudeSessionId: string, cwd: string, label?: string): Promise<SessionInfo>;
    onUpdated(callback: (session: SessionInfo) => void): () => void;
    onCreated(callback: (session: SessionInfo) => void): () => void;
    getLastDefaults(): Promise<SessionDefaults | null>;
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
    ): Promise<void>;
    load(): Promise<LayoutStateSnapshot | null>;
  };

  app: {
    getVersion(): Promise<string>;
    getPlatform(): string;
    getHomeDir(): string;
    selectDirectory(): Promise<string | null>;
    setDockBadge(text: string): void;
    getPathForFile(file: File): string;
    onError(callback: (error: string) => void): () => void;
    onCommand(callback: (command: AppCommand) => void): () => void;
    onUpdateAvailable(
      callback: (info: { version: string }) => void,
    ): () => void;
    openUpdatePage(): Promise<void>;
    checkForUpdate(): Promise<void>;
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
    onChanged(callback: (event: TaskChangeEvent) => void): () => void;
  };

  commits: {
    getDailyStats(date?: string): Promise<DailyCommitStats>;
    getHeatmap(days?: number): Promise<CommitHeatmapEntry[]>;
    getStreaks(): Promise<CommitStreakInfo>;
    getCadence(date?: string): Promise<CommitCadenceInfo>;
    getWeeklyTrend(): Promise<CommitWeeklyTrend>;
    refresh(): Promise<void>;
    onUpdated(callback: () => void): () => void;
  };

  files: {
    list(cwd: string): Promise<FileListResult>;
    read(cwd: string, relativePath: string): Promise<FileReadResult>;
    write(cwd: string, relativePath: string, content: string): Promise<void>;
  };

  tokens: {
    getSessionUsage(claudeSessionId: string): Promise<SessionTokenUsage>;
    getDailyUsage(date?: string): Promise<DailyTokenUsage>;
    getModelBreakdown(days?: number): Promise<ModelTokenBreakdown[]>;
    getWeeklyTrend(): Promise<TokenWeeklyTrend>;
    getHeatmap(days?: number): Promise<TokenHeatmapEntry[]>;
    refresh(): Promise<void>;
    onUpdated(callback: () => void): () => void;
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
    scan(cwd: string): Promise<SlashCommandEntry[]>;
  };

  snippets: {
    scan(cwd: string): Promise<SnippetEntry[]>;
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
