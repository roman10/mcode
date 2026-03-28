import { execFileSync } from 'node:child_process';
import { getDb } from '../../db';
import { logger } from '../../logger';
import {
  parseGeminiSessionList,
  resolveGeminiResumeIndex,
  selectGeminiSessionCandidate,
  type GeminiListedSession,
} from '../gemini-session-store';
import type {
  AgentPostCreateContext,
  AgentPrepareResumeContext,
  AgentRuntimeAdapter,
  PreparedResume,
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
    const db = getDb();
    const row = db.prepare(
      'SELECT session_type, gemini_session_id FROM sessions WHERE session_id = ?',
    ).get(input.sessionId) as { session_type: string; gemini_session_id: string | null } | undefined;
    if (!row || row.session_type !== 'gemini' || row.gemini_session_id) return;

    try {
      const claimedSessionIds = new Set(
        (
          db.prepare(
            'SELECT gemini_session_id FROM sessions WHERE gemini_session_id IS NOT NULL AND session_id != ?',
          ).all(input.sessionId) as { gemini_session_id: string }[]
        ).map((entry) => entry.gemini_session_id),
      );

      const entries = listGeminiSessions(input.command, input.cwd);
      const match = selectGeminiSessionCandidate(entries, {
        initialPrompt: input.initialPrompt,
        claimedSessionIds,
      });

      if (match) {
        const result = db.prepare(
          'UPDATE sessions SET gemini_session_id = ? WHERE session_id = ? AND gemini_session_id IS NULL',
        ).run(match.geminiSessionId, input.sessionId);
        if (result.changes > 0) {
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

export function buildGeminiResumePlan(
  ctx: AgentPrepareResumeContext,
  deps: { listSessions(command: string, cwd: string): GeminiListedSession[] },
): PreparedResume {
  if (!ctx.row.geminiSessionId) throw new Error('Cannot resume: no Gemini session ID recorded');

  const command = ctx.row.command || 'gemini';
  let resumeIndex: number | null = null;
  try {
    const entries = deps.listSessions(command, ctx.row.cwd);
    resumeIndex = resolveGeminiResumeIndex(entries, ctx.row.geminiSessionId);
  } catch (err) {
    throw new Error(`Cannot resume Gemini session: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (resumeIndex == null) {
    throw new Error('Cannot resume: stored Gemini session ID is no longer available in Gemini session list');
  }

  return {
    command,
    cwd: ctx.row.cwd,
    args: ['--resume', String(resumeIndex)],
    env: {},
    hookMode: 'fallback',
    logLabel: 'Gemini',
    logContext: {
      geminiSessionId: ctx.row.geminiSessionId,
      cwd: ctx.row.cwd,
      resumeIndex,
    },
  };
}

export function createGeminiRuntimeAdapter(deps: {
  scheduleSessionCapture(input: ScheduleGeminiSessionCaptureInput): void;
  listSessions(command: string, cwd: string): GeminiListedSession[];
}): AgentRuntimeAdapter {
  return {
    sessionType: 'gemini',
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
  };
}