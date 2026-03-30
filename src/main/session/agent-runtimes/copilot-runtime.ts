import { basename } from 'node:path';
import { getSessionRecord, getClaimedAgentIds, setAgentIdIfNull } from '../session-repository';
import { logger } from '../../logger';
import { findCopilotSessionId } from '../copilot-session-store';
import { hasPermissionPrompt } from '../prompt-detect';
import type {
  AgentCreateContext,
  AgentPostCreateContext,
  AgentPrepareResumeContext,
  AgentRuntimeAdapter,
  PreparedCreate,
  PreparedResume,
  PtyPollContext,
  StateUpdate,
} from '../agent-runtime';

export interface ScheduleCopilotSessionCaptureInput {
  sessionId: string;
  cwd: string;
  startedAt: string;
  initialPrompt?: string;
}

export function isCopilotCommand(command: string): boolean {
  const normalized = basename(command).toLowerCase();
  return normalized === 'copilot' || normalized === 'copilot.exe';
}

export function buildCopilotCreatePlan(ctx: AgentCreateContext): PreparedCreate {
  const { input, hookRuntime } = ctx;
  const bridgeReady = ctx.agentHookBridgeReady && isCopilotCommand(ctx.command);
  const hookMode = bridgeReady && hookRuntime.state === 'ready' ? 'live' : 'fallback';

  const args: string[] = [];
  const model = input.model?.trim() || null;
  if (model) args.push('--model', model);
  if (input.initialPrompt) args.push('-i', input.initialPrompt);

  return {
    hookMode,
    args,
    env: bridgeReady && hookRuntime.port
      ? { MCODE_HOOK_PORT: String(hookRuntime.port) }
      : {},
    dbFields: { model },
  };
}

export function buildCopilotResumePlan(ctx: AgentPrepareResumeContext): PreparedResume {
  if (!ctx.row.copilotSessionId) throw new Error('Cannot resume: no Copilot session ID recorded');

  const command = ctx.row.command || 'copilot';
  const bridgeReady = ctx.agentHookBridgeReady && ctx.hookRuntime.state === 'ready';
  const hookMode = bridgeReady ? 'live' : 'fallback';

  return {
    command,
    cwd: ctx.row.cwd,
    args: ['--resume', ctx.row.copilotSessionId],
    env: bridgeReady && ctx.hookRuntime.port
      ? { MCODE_HOOK_PORT: String(ctx.hookRuntime.port) }
      : {},
    hookMode,
    logLabel: 'Copilot',
    logContext: {
      copilotSessionId: ctx.row.copilotSessionId,
      cwd: ctx.row.cwd,
      hookMode,
    },
  };
}

export function scheduleCopilotSessionCapture(
  input: ScheduleCopilotSessionCaptureInput,
  deps: { broadcastSessionUpdate(sessionId: string): void },
): void {
  const startedAtMs = Date.parse(input.startedAt);
  if (!Number.isFinite(startedAtMs)) return;

  const deadline = Date.now() + 15_000;

  const poll = async (): Promise<void> => {
    const record = getSessionRecord(input.sessionId);
    if (!record || record.session_type !== 'copilot' || record.copilot_session_id) return;

    const claimedSessionIds = getClaimedAgentIds('copilot_session_id', input.sessionId);

    const match = findCopilotSessionId({
      cwd: input.cwd,
      startedAtMs,
      nowMs: Date.now(),
      claimedSessionIds,
    });

    if (match) {
      const claimed = setAgentIdIfNull(input.sessionId, 'copilot_session_id', match);
      if (claimed) {
        logger.info('session', 'Captured Copilot session ID', {
          sessionId: input.sessionId,
          copilotSessionId: match,
        });
        deps.broadcastSessionUpdate(input.sessionId);
      }
      return;
    }

    if (Date.now() >= deadline) {
      logger.warn('session', 'Failed to capture Copilot session ID', {
        sessionId: input.sessionId,
        cwd: input.cwd,
      });
      return;
    }

    setTimeout(() => { poll().catch(() => {}); }, 500);
  };

  poll().catch(() => {});
}

/**
 * Poll-based state detection for Copilot sessions.
 * In Phase 1, hooks are not available so this is the primary detection method.
 */
export function copilotPollState(ctx: PtyPollContext): StateUpdate | null {
  if (
    (ctx.status === 'active' || ctx.status === 'idle') &&
    ctx.attentionLevel !== 'action' &&
    ctx.isQuiescent &&
    hasPermissionPrompt(ctx.buffer)
  ) {
    return {
      status: 'waiting',
      attention: { level: 'action', reason: 'Permission prompt detected' },
    };
  }

  if (ctx.status === 'active' && ctx.isQuiescent) {
    return {
      status: 'idle',
      attention: { level: 'action', reason: 'Copilot finished — awaiting input' },
    };
  }
  return null;
}

export function createCopilotRuntimeAdapter(deps: {
  scheduleSessionCapture(input: ScheduleCopilotSessionCaptureInput): void;
}): AgentRuntimeAdapter {
  return {
    sessionType: 'copilot',
    prepareCreate(ctx: AgentCreateContext): PreparedCreate {
      return buildCopilotCreatePlan(ctx);
    },
    afterCreate(ctx: AgentPostCreateContext): void {
      deps.scheduleSessionCapture({
        sessionId: ctx.sessionId,
        cwd: ctx.cwd,
        startedAt: ctx.startedAt,
        initialPrompt: ctx.initialPrompt,
      });
    },
    prepareResume(ctx: AgentPrepareResumeContext): PreparedResume {
      return buildCopilotResumePlan(ctx);
    },
    pollState: copilotPollState,
  };
}
