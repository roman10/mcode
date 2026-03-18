import type { MosaicNode } from 'react-mosaic-component';
import type { EffortLevel, PermissionMode } from './constants';

// --- Terminal Config ---

export interface TerminalConfig {
  scrollbackLines?: number; // undefined = use DEFAULT_SCROLLBACK_LINES
}

// --- Session ---

export type SessionType = 'claude' | 'terminal';
export type SessionStatus = 'starting' | 'active' | 'idle' | 'waiting' | 'ended';
export type SessionAttentionLevel = 'none' | 'low' | 'medium' | 'high';

export interface SessionInfo {
  sessionId: string;
  label: string;
  cwd: string;
  status: SessionStatus;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
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
}

export interface SessionCreateInput {
  cwd: string;
  label?: string;
  initialPrompt?: string;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
  command?: string;
  sessionType?: SessionType;
  ephemeral?: boolean;
}

export interface SessionDefaults {
  cwd: string;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
}

// --- External (non-mcode) Claude Code sessions ---

export interface ExternalSessionInfo {
  claudeSessionId: string;
  startedAt: string; // ISO 8601
  slug: string;
  customTitle?: string; // meaningful title from Claude Code, when available
}

export interface LayoutStateSnapshot {
  mosaicTree: MosaicNode<string> | null;
  sidebarWidth: number;
}

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
}

// --- Task Queue ---

export type TaskStatus = 'pending' | 'dispatched' | 'completed' | 'failed';

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
}

export interface CreateTaskInput {
  prompt: string;
  cwd: string;
  targetSessionId?: string;
  priority?: number;
  scheduledAt?: string;
  maxRetries?: number;
}

export interface TaskFilter {
  statuses?: TaskStatus[];
  targetSessionId?: string;
  limit?: number;
}

export type TaskChangeEvent =
  | { type: 'upsert'; task: Task }
  | { type: 'remove'; taskId: number };

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
    setTerminalConfig(sessionId: string, config: Partial<TerminalConfig>): Promise<void>;
    clearAttention(sessionId: string): Promise<void>;
    clearAllAttention(): Promise<void>;
    resume(sessionId: string): Promise<SessionInfo>;
    listExternal(limit?: number): Promise<ExternalSessionInfo[]>;
    importExternal(claudeSessionId: string, cwd: string): Promise<SessionInfo>;
    onUpdated(callback: (session: SessionInfo) => void): () => void;
    onCreated(callback: (session: SessionInfo) => void): () => void;
    getLastDefaults(): Promise<SessionDefaults | null>;
    delete(sessionId: string): Promise<void>;
    deleteAllEnded(): Promise<string[]>;
    onDeleted(callback: (sessionId: string) => void): () => void;
    onDeletedBatch(callback: (sessionIds: string[]) => void): () => void;
  };

  hooks: {
    getRuntime(): Promise<HookRuntimeInfo>;
    onEvent(callback: (event: HookEvent) => void): () => void;
    getRecent(sessionId: string, limit?: number): Promise<HookEvent[]>;
  };

  layout: {
    save(
      mosaicTree: MosaicNode<string> | null,
      sidebarWidth?: number,
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
  };

  tasks: {
    create(input: CreateTaskInput): Promise<number>;
    list(filter?: TaskFilter): Promise<Task[]>;
    cancel(taskId: number): Promise<void>;
    onChanged(callback: (event: TaskChangeEvent) => void): () => void;
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
