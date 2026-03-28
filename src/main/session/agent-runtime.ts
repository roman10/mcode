import type { HookRuntimeInfo } from '../../shared/types';

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
  logLabel: 'Codex' | 'Gemini';
  logContext: Record<string, unknown>;
}

export interface AgentRuntimeAdapter {
  sessionType: 'codex' | 'gemini';
  afterCreate?(ctx: AgentPostCreateContext): void;
  prepareResume(ctx: AgentPrepareResumeContext): PreparedResume;
}

export type AgentRuntimeAdapterMap = Record<'codex' | 'gemini', AgentRuntimeAdapter>;

export function getAgentRuntimeAdapter(
  sessionType: string | undefined,
  adapters: AgentRuntimeAdapterMap,
): AgentRuntimeAdapter | null {
  if (sessionType === 'codex' || sessionType === 'gemini') {
    return adapters[sessionType];
  }
  return null;
}