import { basename } from 'node:path';
import { getSessionRecord, getClaimedAgentIds, setAgentIdIfNull } from '../session-repository';
import { logger } from '../../logger';
import { findCodexThreadMatch } from '../codex-session-store';
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

export interface ScheduleCodexThreadCaptureInput {
  sessionId: string;
  cwd: string;
  startedAt: string;
  initialPrompt?: string;
}

export function scheduleCodexThreadCapture(
  input: ScheduleCodexThreadCaptureInput,
  deps: { broadcastSessionUpdate(sessionId: string): void },
): void {
  const startedAtMs = Date.parse(input.startedAt);
  if (!Number.isFinite(startedAtMs)) return;

  const deadline = Date.now() + 15_000;
  const poll = async (): Promise<void> => {
    const record = getSessionRecord(input.sessionId);
    if (!record || record.session_type !== 'codex' || record.codex_thread_id) return;

    const claimedThreadIds = getClaimedAgentIds('codex_thread_id', input.sessionId);

    const match = findCodexThreadMatch({
      cwd: input.cwd,
      initialPrompt: input.initialPrompt,
      startedAtMs,
      nowMs: Date.now(),
      claimedThreadIds,
    });
    if (match) {
      const claimed = setAgentIdIfNull(input.sessionId, 'codex_thread_id', match.id);
      if (claimed) {
        logger.info('session', 'Captured Codex thread ID', {
          sessionId: input.sessionId,
          codexThreadId: match.id,
        });
        deps.broadcastSessionUpdate(input.sessionId);
      }
      return;
    }

    if (Date.now() >= deadline) {
      logger.warn('session', 'Failed to capture Codex thread ID', {
        sessionId: input.sessionId,
        cwd: input.cwd,
      });
      return;
    }

    setTimeout(() => {
      poll().catch(() => { });
    }, 500);
  };

  poll().catch(() => { });
}

export function isCodexCommand(command: string): boolean {
  const normalized = basename(command).toLowerCase();
  return normalized === 'codex' || normalized === 'codex.exe';
}

export function buildCodexCreatePlan(ctx: AgentCreateContext): PreparedCreate {
  const { input, hookRuntime } = ctx;
  // Only enable hooks when the command is a recognized Codex binary and
  // the hook bridge is ready — matches the original isCodexCommand guard.
  const bridgeReady = ctx.agentHookBridgeReady && isCodexCommand(ctx.command);
  const hookMode = bridgeReady && hookRuntime.state === 'ready' ? 'live' : 'fallback';

  const args: string[] = [];
  if (bridgeReady) args.push('--enable', 'codex_hooks');
  if (input.initialPrompt) args.push(input.initialPrompt);

  return {
    hookMode,
    args,
    env: bridgeReady && hookRuntime.port
      ? { MCODE_HOOK_PORT: String(hookRuntime.port) }
      : {},
    dbFields: {},
  };
}

export function buildCodexResumePlan(ctx: AgentPrepareResumeContext): PreparedResume {
  if (!ctx.row.codexThreadId) throw new Error('Cannot resume: no Codex thread ID recorded');

  const codexBridgeReady = ctx.agentHookBridgeReady && ctx.hookRuntime.state === 'ready';
  const hookMode = codexBridgeReady ? 'live' : 'fallback';

  return {
    command: ctx.row.command || 'codex',
    cwd: ctx.row.cwd,
    args: [
      ...(codexBridgeReady ? ['--enable', 'codex_hooks'] : []),
      'resume',
      ctx.row.codexThreadId,
    ],
    env: codexBridgeReady && ctx.hookRuntime.port
      ? { MCODE_HOOK_PORT: String(ctx.hookRuntime.port) }
      : {},
    hookMode,
    logLabel: 'Codex',
    logContext: {
      codexThreadId: ctx.row.codexThreadId,
      cwd: ctx.row.cwd,
      hookMode,
    },
  };
}

/**
 * Poll-based state detection for Codex sessions.
 *
 * For hookMode 'live' sessions, hooks handle state transitions and
 * this polling is just a safety net.
 */
export function codexPollState(ctx: PtyPollContext): StateUpdate | null {
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
      attention: { level: 'action', reason: 'Codex finished — awaiting input' },
    };
  }
  return null;
}

export function createCodexRuntimeAdapter(deps: {
  scheduleThreadCapture(input: ScheduleCodexThreadCaptureInput): void;
}): AgentRuntimeAdapter {
  return {
    sessionType: 'codex',
    prepareCreate(ctx: AgentCreateContext): PreparedCreate {
      return buildCodexCreatePlan(ctx);
    },
    afterCreate(ctx: AgentPostCreateContext): void {
      deps.scheduleThreadCapture({
        sessionId: ctx.sessionId,
        cwd: ctx.cwd,
        startedAt: ctx.startedAt,
        initialPrompt: ctx.initialPrompt,
      });
    },
    prepareResume(ctx: AgentPrepareResumeContext): PreparedResume {
      return buildCodexResumePlan(ctx);
    },
    pollState: codexPollState,
  };
}
