import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { getSessionRecord, getClaimedAgentIds, setAgentIdIfNull } from '../session-repository';
import { logger } from '../../logger';
import {
  parseGeminiSessionList,
  resolveGeminiResumeIndex,
  selectGeminiSessionCandidate,
  type GeminiListedSession,
} from '../gemini-session-store';
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

export interface ScheduleGeminiSessionCaptureInput {
  sessionId: string;
  cwd: string;
  command: string;
  initialPrompt?: string;
}

export function listGeminiSessions(command: string, cwd: string): GeminiListedSession[] {
  const output = execFileSync(command, ['--list-sessions'], {
    cwd,
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return parseGeminiSessionList(output);
}

export function scheduleGeminiSessionCapture(
  input: ScheduleGeminiSessionCaptureInput,
  deps: { broadcastSessionUpdate(sessionId: string): void },
): void {
  const deadline = Date.now() + 15_000;
  const poll = async (): Promise<void> => {
    const record = getSessionRecord(input.sessionId);
    if (!record || record.session_type !== 'gemini' || record.gemini_session_id) return;

    try {
      const claimedSessionIds = getClaimedAgentIds('gemini_session_id', input.sessionId);

      const entries = listGeminiSessions(input.command, input.cwd);
      const match = selectGeminiSessionCandidate(entries, {
        initialPrompt: input.initialPrompt,
        claimedSessionIds,
      });

      if (match) {
        const claimed = setAgentIdIfNull(input.sessionId, 'gemini_session_id', match.geminiSessionId);
        if (claimed) {
          logger.info('session', 'Captured Gemini session ID', {
            sessionId: input.sessionId,
            geminiSessionId: match.geminiSessionId,
          });
          deps.broadcastSessionUpdate(input.sessionId);
        }
        return;
      }
    } catch {
      // Gemini may not list the new session immediately; keep polling until deadline.
    }

    if (Date.now() >= deadline) {
      logger.warn('session', 'Failed to capture Gemini session ID', {
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

export function isGeminiCommand(command: string): boolean {
  const normalized = basename(command).toLowerCase();
  return normalized === 'gemini' || normalized === 'gemini.exe';
}

export function buildGeminiResumePlan(
  ctx: AgentPrepareResumeContext,
  deps: { listSessions(command: string, cwd: string): GeminiListedSession[] },
): PreparedResume {
  if (!ctx.row.geminiSessionId) throw new Error('Cannot resume: no Gemini session ID recorded');

  const command = ctx.row.command || 'gemini';
  const geminiSessionId = ctx.row.geminiSessionId;
  let entries: GeminiListedSession[] = [];
  try {
    entries = deps.listSessions(command, ctx.row.cwd);
  } catch (err) {
    throw new Error(`Cannot resume Gemini session: ${err instanceof Error ? err.message : String(err)}`);
  }

  const resumeIndex = resolveGeminiResumeIndex(entries, geminiSessionId);
  if (resumeIndex == null) {
    const availableIds = entries.map((e) => e.geminiSessionId).join(', ');
    throw new Error(
      `Gemini session ${geminiSessionId} is no longer available in the session list. ` +
      `Found ${entries.length} session(s)${entries.length > 0 ? `: ${availableIds}` : ''}.`,
    );
  }

  const bridgeReady = ctx.agentHookBridgeReady && ctx.hookRuntime.state === 'ready';
  const hookMode = bridgeReady ? 'live' : 'fallback';

  return {
    command,
    cwd: ctx.row.cwd,
    args: ['--resume', String(resumeIndex)],
    env: bridgeReady && ctx.hookRuntime.port
      ? { MCODE_HOOK_PORT: String(ctx.hookRuntime.port) }
      : {},
    hookMode,
    logLabel: 'Gemini',
    logContext: {
      geminiSessionId: ctx.row.geminiSessionId,
      cwd: ctx.row.cwd,
      resumeIndex,
      hookMode,
    },
  };
}

export function buildGeminiCreatePlan(ctx: AgentCreateContext): PreparedCreate {
  const { input, hookRuntime } = ctx;
  const bridgeReady = ctx.agentHookBridgeReady && isGeminiCommand(ctx.command);
  const hookMode = bridgeReady && hookRuntime.state === 'ready' ? 'live' : 'fallback';

  const args: string[] = [];
  if (input.model) args.push('--model', input.model);
  if (input.initialPrompt) args.push(input.initialPrompt);

  return {
    hookMode,
    args,
    env: bridgeReady && hookRuntime.port
      ? { MCODE_HOOK_PORT: String(hookRuntime.port) }
      : {},
    dbFields: {
      model: input.model?.trim() || null,
    },
  };
}

/**
 * Poll-based state detection for Gemini sessions.
 *
 * For hookMode 'live' sessions, hooks handle state transitions and
 * this polling is just a safety net.
 */
export function geminiPollState(ctx: PtyPollContext): StateUpdate | null {
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
      attention: { level: 'action', reason: 'Gemini finished — awaiting input' },
    };
  }
  return null;
}

export function createGeminiRuntimeAdapter(deps: {
  scheduleSessionCapture(input: ScheduleGeminiSessionCaptureInput): void;
  listSessions(command: string, cwd: string): GeminiListedSession[];
}): AgentRuntimeAdapter {
  return {
    sessionType: 'gemini',
    prepareCreate(ctx: AgentCreateContext): PreparedCreate {
      return buildGeminiCreatePlan(ctx);
    },
    afterCreate(ctx: AgentPostCreateContext): void {
      deps.scheduleSessionCapture({
        sessionId: ctx.sessionId,
        cwd: ctx.cwd,
        command: ctx.command,
        initialPrompt: ctx.initialPrompt,
      });
    },
    prepareResume(ctx: AgentPrepareResumeContext): PreparedResume {
      return buildGeminiResumePlan(ctx, {
        listSessions: deps.listSessions,
      });
    },
    pollState: geminiPollState,
  };
}
