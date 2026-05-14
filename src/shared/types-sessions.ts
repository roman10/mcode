import type { EffortLevel, PermissionMode } from './constants';

// --- Terminal Config ---

export interface TerminalConfig {
  scrollbackLines?: number; // undefined = use DEFAULT_SCROLLBACK_LINES
}

// --- Session ---

export type SessionType = 'claude' | 'codex' | 'gemini' | 'copilot' | 'terminal';
export type SessionStatus = 'starting' | 'active' | 'idle' | 'waiting' | 'detached' | 'ended';
export type SessionAttentionLevel = 'none' | 'info' | 'action';

export interface SessionInfo {
  sessionId: string;
  label: string;
  cwd: string;
  status: SessionStatus;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
  enableAutoMode?: boolean;
  allowBypassPermissions?: boolean;
  worktree: string | null;
  startedAt: string; // ISO 8601
  endedAt: string | null;

  claudeSessionId: string | null;
  codexThreadId: string | null;
  geminiSessionId: string | null;
  copilotSessionId: string | null;
  lastTool: string | null;
  lastEventAt: string | null;
  attentionLevel: SessionAttentionLevel;
  attentionReason: string | null;
  hookMode: 'live' | 'fallback';
  sessionType: SessionType;
  terminalConfig: TerminalConfig;
  accountId: string | null;
  autoClose: boolean;
  model: string | null;
  isTest: boolean;
}

export interface SessionCreateInput {
  cwd: string;
  label?: string;
  initialPrompt?: string;
  model?: string;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
  enableAutoMode?: boolean;
  allowBypassPermissions?: boolean;
  worktree?: string;
  command?: string;
  args?: string[];
  sessionType?: SessionType;
  accountId?: string;
  initialCommand?: string;
  autoClose?: boolean;
  isTest?: boolean;
}

export interface SessionDefaults {
  cwd: string;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
  enableAutoMode?: boolean;
  accountId?: string;
  model?: string;
}

// --- External (non-mcode) Claude Code sessions ---

export interface ExternalSessionInfo {
  claudeSessionId: string;
  startedAt: string; // ISO 8601
  slug: string;
  customTitle?: string; // meaningful title from Claude Code, when available
}
