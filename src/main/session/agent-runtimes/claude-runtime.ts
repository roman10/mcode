import { stripAnsi } from '../../../shared/strip-ansi';
import { isAtClaudePrompt, isAtUserChoice } from '../prompt-detect';
import { USER_CHOICE_TOOLS } from '../session-state-machine';
import type { AgentRuntimeAdapter, PtyPollContext, StateUpdate } from '../agent-runtime';

const PERMISSION_PATTERNS = [
  /Allow\s+once/,
  /Deny\s+once/,
  /Allow\s+always/,
];

/**
 * Poll-based state detection for Claude Code sessions.
 *
 * For live-hook sessions this is a safety net; hooks handle the primary
 * transitions.  For fallback sessions (older Claude versions, hook server
 * unavailable) this is the only detection mechanism.
 */
export function claudePollState(ctx: PtyPollContext): StateUpdate | null {
  const tail = stripAnsi(ctx.buffer.slice(-2000));
  const rawTail = ctx.buffer.slice(-2000);
  const hasPermissionPrompt = PERMISSION_PATTERNS.some((re) => re.test(tail));

  if (
    (ctx.status === 'active' || ctx.status === 'idle') &&
    ctx.attentionLevel !== 'action' &&
    hasPermissionPrompt &&
    ctx.isQuiescent
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

export function createClaudeRuntimeAdapter(): AgentRuntimeAdapter {
  return {
    sessionType: 'claude',
    pollState: claudePollState,
  };
}
