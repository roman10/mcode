import { getDb } from '../../db';
import { logger } from '../../logger';
import { findCodexThreadMatch } from '../codex-session-store';
import type {
  AgentPostCreateContext,
  AgentPrepareResumeContext,
  AgentRuntimeAdapter,
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
    const db = getDb();
    const row = db.prepare(
      'SELECT session_type, codex_thread_id FROM sessions WHERE session_id = ?',
    ).get(input.sessionId) as { session_type: string; codex_thread_id: string | null } | undefined;
    if (!row || row.session_type !== 'codex' || row.codex_thread_id) return;

    const claimedThreadIds = new Set(
      (
        db.prepare(
          'SELECT codex_thread_id FROM sessions WHERE codex_thread_id IS NOT NULL AND session_id != ?',
        ).all(input.sessionId) as { codex_thread_id: string }[]
      ).map((entry) => entry.codex_thread_id),
    );

    const match = findCodexThreadMatch({
      cwd: input.cwd,
      initialPrompt: input.initialPrompt,
      startedAtMs,
      nowMs: Date.now(),
      claimedThreadIds,
    });
    if (match) {
      const result = db.prepare(
        'UPDATE sessions SET codex_thread_id = ? WHERE session_id = ? AND codex_thread_id IS NULL',
      ).run(match.id, input.sessionId);
      if (result.changes > 0) {
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

export function buildCodexResumePlan(ctx: AgentPrepareResumeContext): PreparedResume {
  if (!ctx.row.codexThreadId) throw new Error('Cannot resume: no Codex thread ID recorded');

  const codexBridgeReady = ctx.codexBridgeReady && ctx.hookRuntime.state === 'ready';
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