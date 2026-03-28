import type { AgentSessionType } from '../../shared/session-agents';
import type {
  HookRuntimeInfo,
  SessionAttentionLevel,
  SessionStatus,
} from '../../shared/types';

export interface AgentPostCreateContext {
  sessionId: string;
  cwd: string;
  startedAt: string;
  command: string;
  initialPrompt?: string;
}

export interface AgentResumeRow {
  command: string | null;
  cwd: string;
  codexThreadId: string | null;
  geminiSessionId: string | null;
}

export interface AgentPrepareResumeContext {
  sessionId: string;
  row: AgentResumeRow;
  hookRuntime: HookRuntimeInfo;
  codexBridgeReady: boolean;
}

export interface PreparedResume {
  command: string;
  cwd: string;
  args: string[];
  env: Record<string, string>;
  hookMode: 'live' | 'fallback';
  logLabel: string;
  logContext: Record<string, unknown>;
}

// --- Polling types ---

/** Context passed to an adapter's pollState method during fallback polling. */
export interface PtyPollContext {
  sessionId: string;
  status: SessionStatus;
  attentionLevel: SessionAttentionLevel;
  lastTool: string | null;
  buffer: string;
  lastDataAt: number;
  isQuiescent: boolean;
  hasPendingTasks: boolean;
}

/** Result from an adapter's pollState: a status change with optional attention update. */
export interface StateUpdate {
  status: SessionStatus;
  attention?: { level: SessionAttentionLevel; reason: string | null };
}

// --- Adapter interface ---

export interface AgentRuntimeAdapter {
  sessionType: AgentSessionType;
  afterCreate?(ctx: AgentPostCreateContext): void;
  prepareResume?(ctx: AgentPrepareResumeContext): PreparedResume;
  pollState?(ctx: PtyPollContext): StateUpdate | null;
}

export type AgentRuntimeAdapterMap = Record<AgentSessionType, AgentRuntimeAdapter>;

export function getAgentRuntimeAdapter(
  sessionType: string | undefined,
  adapters: AgentRuntimeAdapterMap,
): AgentRuntimeAdapter | null {
  if (sessionType === 'claude' || sessionType === 'codex' || sessionType === 'gemini') {
    return adapters[sessionType];
  }
  return null;
}