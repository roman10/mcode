import type { SessionStatus } from './types-sessions';

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
