import { basename } from 'node:path';
import { hasPermissionPrompt } from '../prompt-detect';
import type {
  AgentCreateContext,
  AgentRuntimeAdapter,
  PreparedCreate,
  PtyPollContext,
  StateUpdate,
} from '../agent-runtime';

export function isAgyCommand(command: string): boolean {
  const normalized = basename(command).toLowerCase();
  return normalized === 'agy' || normalized === 'agy.exe';
}

export function buildAgyCreatePlan(ctx: AgentCreateContext): PreparedCreate {
  const { input, hookRuntime } = ctx;
  // agy v1.0.1 has no hook bridge, so `hookBridgeReady['agy']` is never set and this
  // resolves to 'fallback' (poll-based detection). The structure mirrors the other
  // adapters so a future hook integration can drop in without reshaping this.
  const bridgeReady = ctx.agentHookBridgeReady && isAgyCommand(ctx.command);
  const hookMode = bridgeReady && hookRuntime.state === 'ready' ? 'live' : 'fallback';

  const args: string[] = [];
  if (input.permissionMode === 'skipPermissions') args.push('--dangerously-skip-permissions');
  else if (input.permissionMode === 'sandbox') args.push('--sandbox');
  // No --model flag: agy chooses the model only via the in-TUI /model command.
  if (input.initialPrompt) args.push('-i', input.initialPrompt);

  return {
    hookMode,
    args,
    env: bridgeReady && hookRuntime.port
      ? { MCODE_HOOK_PORT: String(hookRuntime.port) }
      : {},
    dbFields: { permissionMode: input.permissionMode ?? null },
  };
}

/**
 * Poll-based state detection for agy sessions. agy has no hook bridge, so this is
 * the primary (only) detection path — same shape as Copilot's poller.
 *
 * Permission-prompt matching is delegated to `hasPermissionPrompt`. If agy's TUI
 * uses approve/deny wording the shared matcher doesn't recognise, extend that helper
 * (e.g. an optional `extraPatterns`) rather than forking this function.
 * TODO(agy live): confirm agy's permission-prompt wording against a live run.
 */
export function agyPollState(ctx: PtyPollContext): StateUpdate | null {
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
    if (ctx.hasPendingTasks) {
      return { status: 'idle' };
    }
    return {
      status: 'idle',
      attention: { level: 'action', reason: 'Antigravity finished — awaiting input' },
    };
  }
  return null;
}

export function createAgyRuntimeAdapter(): AgentRuntimeAdapter {
  return {
    sessionType: 'agy',
    prepareCreate(ctx: AgentCreateContext): PreparedCreate {
      return buildAgyCreatePlan(ctx);
    },
    // No prepareResume / afterCreate in v1: resume is deferred (resumeIdentityKind: null),
    // and there is no session-id capture to schedule.
    pollState: agyPollState,
  };
}
