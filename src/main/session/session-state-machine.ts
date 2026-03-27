import type { SessionStatus, SessionAttentionLevel } from '../../shared/types';

// --- Types ---

export type HookEventName =
  | 'SessionStart'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'PermissionRequest'
  | 'Notification'
  | 'PostToolUseFailure'
  | 'SessionEnd'
  | 'UserPromptSubmit';

export type AttentionRule =
  | { type: 'clear' }
  | { type: 'clear-if-action' }
  | { type: 'set-action'; reason: string }
  | { type: 'set-action-if-active-no-pending'; reason: string }
  | { type: 'set-info-if-not-action'; reason: string }
  | { type: 'preserve' };

export type LastToolAction =
  | { type: 'set'; toolName: string }
  | { type: 'clear' }
  | { type: 'preserve' };

export interface TransitionResult {
  status: SessionStatus;
  attention: AttentionRule;
  lastTool: LastToolAction;
  selfHealed: boolean;
}

export interface TransitionContext {
  currentStatus: SessionStatus;
  lastTool: string | null;
  toolName: string | null;
}

export interface AttentionResolution {
  level: SessionAttentionLevel;
  reason: string | null;
}

// --- Constants ---

/** Tools whose Stop event should transition to 'waiting' instead of 'idle'. */
export const USER_CHOICE_TOOLS = new Set(['ExitPlanMode', 'AskUserQuestion']);

// --- Pure functions ---

/**
 * Compute the state transition for a hook event.
 * Returns null if no transition should occur (e.g., session is ended).
 */
export function computeTransition(
  event: HookEventName,
  ctx: TransitionContext,
): TransitionResult | null {
  if (ctx.currentStatus === 'ended') return null;

  let effectiveStatus = ctx.currentStatus;
  let selfHealed = false;
  if (ctx.currentStatus === 'starting' && event !== 'SessionStart') {
    effectiveStatus = 'active';
    selfHealed = true;
  }

  switch (event) {
    case 'SessionStart':
      return {
        status: effectiveStatus === 'starting' ? 'active' : effectiveStatus,
        attention: { type: 'clear-if-action' },
        lastTool: { type: 'preserve' },
        selfHealed,
      };

    case 'PreToolUse':
    case 'PostToolUse': {
      const resumes = effectiveStatus === 'waiting' || effectiveStatus === 'idle';
      return {
        status: resumes ? 'active' : effectiveStatus,
        attention: resumes ? { type: 'clear-if-action' } : { type: 'preserve' },
        lastTool: ctx.toolName ? { type: 'set', toolName: ctx.toolName } : { type: 'preserve' },
        selfHealed,
      };
    }

    case 'Stop':
      return computeStopTransition(effectiveStatus, ctx, selfHealed);

    case 'PermissionRequest':
      return {
        status: 'waiting',
        attention: {
          type: 'set-action',
          reason: ctx.toolName ? `Permission needed: ${ctx.toolName}` : 'Permission needed',
        },
        lastTool: { type: 'preserve' },
        selfHealed,
      };

    case 'Notification':
      return {
        status: effectiveStatus,
        attention: { type: 'set-info-if-not-action', reason: 'Notification from Claude' },
        lastTool: { type: 'preserve' },
        selfHealed,
      };

    case 'PostToolUseFailure':
      return {
        status: effectiveStatus,
        attention: { type: 'preserve' },
        lastTool: { type: 'preserve' },
        selfHealed,
      };

    case 'UserPromptSubmit': {
      const resumes = effectiveStatus === 'idle' || effectiveStatus === 'waiting';
      return {
        status: resumes ? 'active' : effectiveStatus,
        attention: resumes ? { type: 'clear-if-action' } : { type: 'preserve' },
        lastTool: { type: 'clear' },
        selfHealed,
      };
    }

    case 'SessionEnd':
      return {
        status: 'ended',
        attention: { type: 'clear' },
        lastTool: { type: 'preserve' },
        selfHealed,
      };
  }
}

function computeStopTransition(
  effectiveStatus: SessionStatus,
  ctx: TransitionContext,
  selfHealed: boolean,
): TransitionResult {
  if (ctx.lastTool && USER_CHOICE_TOOLS.has(ctx.lastTool)) {
    return {
      status: 'waiting',
      attention: { type: 'set-action', reason: 'Waiting for your response' },
      lastTool: { type: 'clear' },
      selfHealed,
    };
  }
  return {
    status: 'idle',
    attention: effectiveStatus === 'active'
      ? { type: 'set-action-if-active-no-pending', reason: 'Claude finished — awaiting next input' }
      : { type: 'preserve' },
    lastTool: { type: 'preserve' },
    selfHealed,
  };
}

/**
 * Resolve an attention rule into a concrete (level, reason) pair.
 *
 * The returned `reason` follows the session-manager's DB update semantics:
 * - If `level !== currentLevel`: both level and reason are written (reason may be null to clear it)
 * - If `level === currentLevel` and `reason !== null`: only reason is written
 * - If `level === currentLevel` and `reason === null`: no DB update for attention
 */
export function resolveAttention(
  rule: AttentionRule,
  currentAttention: SessionAttentionLevel,
  ctx: { hasPendingTasks: boolean },
): AttentionResolution {
  switch (rule.type) {
    case 'clear-if-action':
      return currentAttention === 'action'
        ? { level: 'none', reason: null }
        : { level: currentAttention, reason: null };

    case 'set-action':
      return { level: 'action', reason: rule.reason };

    case 'set-action-if-active-no-pending':
      // Guard: don't re-set action if already action (preserves existing reason)
      if (currentAttention === 'action' || ctx.hasPendingTasks) {
        return { level: currentAttention, reason: null };
      }
      return { level: 'action', reason: rule.reason };

    case 'set-info-if-not-action':
      return currentAttention === 'action'
        ? { level: currentAttention, reason: null }
        : { level: 'info', reason: rule.reason };

    case 'clear':
      return { level: 'none', reason: null };

    case 'preserve':
      return { level: currentAttention, reason: null };
  }
}
