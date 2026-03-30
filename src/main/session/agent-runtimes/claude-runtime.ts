import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import { isAtClaudePrompt, isAtUserChoice, hasPermissionPrompt } from '../prompt-detect';
import { USER_CHOICE_TOOLS } from '../session-state-machine';
import type {
  AgentCreateContext,
  AgentPrepareResumeContext,
  AgentRuntimeAdapter,
  PreparedCreate,
  PreparedResume,
  PtyPollContext,
  StateUpdate,
} from '../agent-runtime';

/**
 * Poll-based state detection for Claude Code sessions.
 *
 * For live-hook sessions this is a safety net; hooks handle the primary
 * transitions.  For fallback sessions (older Claude versions, hook server
 * unavailable) this is the only detection mechanism.
 */
export function claudePollState(ctx: PtyPollContext): StateUpdate | null {
  const rawTail = ctx.buffer.slice(-2000);

  if (
    (ctx.status === 'active' || ctx.status === 'idle') &&
    ctx.attentionLevel !== 'action' &&
    ctx.isQuiescent &&
    hasPermissionPrompt(rawTail)
  ) {
    // Permission prompt detected: quiescent + pattern visible
    return {
      status: 'waiting',
      attention: { level: 'action', reason: 'Permission prompt detected' },
    };
  }

  if (
    (ctx.status === 'active' || ctx.status === 'idle') &&
    ctx.attentionLevel !== 'action' &&
    isAtUserChoice(rawTail) &&
    (ctx.isQuiescent || (ctx.lastTool != null && USER_CHOICE_TOOLS.has(ctx.lastTool)))
  ) {
    // User-choice menu detected (plan mode, AskUserQuestion, etc.)
    // When lastTool confirms a user-choice tool, skip quiescence to avoid
    // status bar updates blocking detection indefinitely.
    return {
      status: 'waiting',
      attention: { level: 'action', reason: 'Waiting for your response' },
    };
  }

  if (
    (ctx.status === 'active' || ctx.status === 'waiting') &&
    ctx.isQuiescent &&
    isAtClaudePrompt(rawTail) &&
    !isAtUserChoice(rawTail)
  ) {
    // Idle prompt detected: Claude is waiting at ❯ for new input.
    // Guard against user-choice menus whose ❯ cursor also satisfies isAtClaudePrompt.
    if (ctx.hasPendingTasks) {
      return { status: 'idle' };
    }
    return {
      status: 'idle',
      attention: { level: 'action', reason: 'Claude finished — awaiting next input' },
    };
  }

  // No transition detected.
  // Note: no explicit waiting → active recovery here. When the user
  // answers a permission prompt, PreToolUse/PostToolUse hooks handle
  // the transition. The idle-prompt branch above also covers 'waiting'
  // as a fallback if hooks fail and Claude reaches the ❯ prompt.
  return null;
}

export function isClaudeCommand(command: string): boolean {
  const normalized = basename(command).toLowerCase();
  return normalized === 'claude' || normalized === 'claude.exe' || normalized === 'claude.cmd';
}

export function buildClaudeResumePlan(
  ctx: AgentPrepareResumeContext,
  deps: { existsSync?: (path: string) => boolean } = {},
): PreparedResume {
  const checkExists = deps.existsSync ?? existsSync;

  if (ctx.row.claudeSessionId == null) {
    throw new Error('Cannot resume: no Claude session ID recorded');
  }
  const claudeSessionId = ctx.row.claudeSessionId;

  let effectiveCwd: string;
  if (ctx.row.worktree != null && ctx.row.worktree !== '') {
    effectiveCwd = join(ctx.row.cwd, '.claude', 'worktrees', ctx.row.worktree);
    if (!checkExists(effectiveCwd)) {
      throw new Error(`Worktree directory no longer exists: ${effectiveCwd}`);
    }
  } else if (ctx.row.worktree === '') {
    throw new Error('Cannot resume: worktree name was never captured.');
  } else {
    effectiveCwd = ctx.row.cwd;
  }

  const hookMode = ctx.hookRuntime.state === 'ready' ? 'live' : 'fallback';

  const args = ['--resume', claudeSessionId];
  if (ctx.row.permissionMode) args.push('--permission-mode', ctx.row.permissionMode);
  if (ctx.row.effort) args.push('--effort', ctx.row.effort);
  if (ctx.row.enableAutoMode) args.push('--enable-auto-mode');
  if (ctx.row.allowBypassPermissions) args.push('--allow-dangerously-skip-permissions');

  return {
    command: ctx.row.command || 'claude',
    cwd: effectiveCwd,
    args,
    env: {},
    hookMode,
    logLabel: 'Claude',
    logContext: { claudeSessionId, cwd: effectiveCwd, worktree: ctx.row.worktree, hookMode },
  };
}

export function buildClaudeCreatePlan(ctx: AgentCreateContext): PreparedCreate {
  if (isClaudeCommand(ctx.command) && ctx.hookRuntime.state === 'initializing') {
    throw new Error('Hook system is still initializing. Retry session creation shortly.');
  }

  const hookMode =
    isClaudeCommand(ctx.command) && ctx.hookRuntime.state === 'ready' ? 'live' : 'fallback';

  const args: string[] = [];
  if (ctx.input.worktree !== undefined) {
    args.push('--worktree');
    if (ctx.input.worktree) args.push(ctx.input.worktree);
  }
  if (ctx.input.permissionMode) args.push('--permission-mode', ctx.input.permissionMode);
  if (ctx.input.effort) args.push('--effort', ctx.input.effort);
  if (ctx.input.enableAutoMode) args.push('--enable-auto-mode');
  if (ctx.input.allowBypassPermissions) args.push('--allow-dangerously-skip-permissions');
  if (ctx.input.initialPrompt) args.push(ctx.input.initialPrompt);

  const dbFields = {
    permissionMode: ctx.input.permissionMode ?? null,
    effort: ctx.input.effort ?? null,
    enableAutoMode:
      ctx.input.enableAutoMode === true ? 1 : ctx.input.enableAutoMode === false ? 0 : null,
    allowBypassPermissions:
      ctx.input.allowBypassPermissions === true
        ? 1
        : ctx.input.allowBypassPermissions === false
          ? 0
          : null,
    worktree: ctx.input.worktree !== undefined ? (ctx.input.worktree || '') : null,
  };

  return { hookMode, args, env: {}, dbFields };
}

export function createClaudeRuntimeAdapter(): AgentRuntimeAdapter {
  return {
    sessionType: 'claude',
    prepareCreate(ctx: AgentCreateContext): PreparedCreate {
      return buildClaudeCreatePlan(ctx);
    },
    prepareResume(ctx: AgentPrepareResumeContext): PreparedResume {
      return buildClaudeResumePlan(ctx);
    },
    pollState: claudePollState,
  };
}
