import { describe, it, expect } from 'vitest';
import {
  buildAgyCreatePlan,
  isAgyCommand,
  agyPollState,
  createAgyRuntimeAdapter,
} from '../../../src/main/session/agent-runtimes/agy-runtime';
import type { AgentCreateContext, PtyPollContext } from '../../../src/main/session/agent-runtime';

function makeCreateCtx(overrides?: Partial<AgentCreateContext['input']> & {
  hookReady?: boolean;
  hookPort?: number;
  command?: string;
}): AgentCreateContext {
  const { hookReady, hookPort, command, ...inputOverrides } = overrides ?? {};
  return {
    input: {
      cwd: '/tmp',
      ...inputOverrides,
    },
    command: command ?? 'agy',
    hookRuntime: hookReady
      ? { state: 'ready', port: hookPort ?? 7777, warning: null }
      : { state: 'initializing', port: null, warning: null },
    agentHookBridgeReady: hookReady ?? false,
  };
}

describe('isAgyCommand', () => {
  it('matches "agy" and "agy.exe"', () => {
    expect(isAgyCommand('agy')).toBe(true);
    expect(isAgyCommand('agy.exe')).toBe(true);
  });

  it('matches absolute path to agy', () => {
    expect(isAgyCommand('/Users/me/.local/bin/agy')).toBe(true);
  });

  it('does not match unrelated commands', () => {
    expect(isAgyCommand('not-agy')).toBe(false);
    expect(isAgyCommand('claude')).toBe(false);
    expect(isAgyCommand('gemini')).toBe(false);
  });
});

describe('buildAgyCreatePlan', () => {
  it('produces a bare launch with no options', () => {
    const plan = buildAgyCreatePlan(makeCreateCtx());
    expect(plan.hookMode).toBe('fallback');
    expect(plan.args).toEqual([]);
    expect(plan.env).toEqual({});
    expect(plan.dbFields.permissionMode).toBeNull();
  });

  it('passes --dangerously-skip-permissions for the skipPermissions mode', () => {
    const plan = buildAgyCreatePlan(makeCreateCtx({ permissionMode: 'skipPermissions' }));
    expect(plan.args).toEqual(['--dangerously-skip-permissions']);
    expect(plan.dbFields.permissionMode).toBe('skipPermissions');
  });

  it('passes --sandbox for the sandbox mode', () => {
    const plan = buildAgyCreatePlan(makeCreateCtx({ permissionMode: 'sandbox' }));
    expect(plan.args).toEqual(['--sandbox']);
    expect(plan.dbFields.permissionMode).toBe('sandbox');
  });

  it('passes no permission flag when permissionMode is unset', () => {
    const plan = buildAgyCreatePlan(makeCreateCtx());
    expect(plan.args).not.toContain('--dangerously-skip-permissions');
    expect(plan.args).not.toContain('--sandbox');
  });

  it('passes -i when initialPrompt is provided', () => {
    const plan = buildAgyCreatePlan(makeCreateCtx({ initialPrompt: 'review the code' }));
    expect(plan.args).toEqual(['-i', 'review the code']);
  });

  it('places the permission flag before the -i prompt', () => {
    const plan = buildAgyCreatePlan(makeCreateCtx({
      permissionMode: 'skipPermissions',
      initialPrompt: 'fix bugs',
    }));
    expect(plan.args).toEqual(['--dangerously-skip-permissions', '-i', 'fix bugs']);
  });

  it('never emits --model, even when a model is supplied (agy has no model flag)', () => {
    const plan = buildAgyCreatePlan(makeCreateCtx({ model: 'gemini-3.1-pro', initialPrompt: 'go' }));
    expect(plan.args).not.toContain('--model');
    expect(plan.args).toEqual(['-i', 'go']);
    expect(plan.dbFields.model).toBeUndefined();
  });

  it('stays in fallback hook mode when no bridge is ready (agy has no hooks)', () => {
    const plan = buildAgyCreatePlan(makeCreateCtx({ hookReady: false }));
    expect(plan.hookMode).toBe('fallback');
    expect(plan.env).toEqual({});
  });
});

describe('agyPollState', () => {
  function makePollCtx(overrides: Partial<PtyPollContext>): PtyPollContext {
    return {
      sessionId: 'test-session',
      status: 'active',
      attentionLevel: 'none',
      lastTool: null,
      buffer: '',
      lastDataAt: Date.now(),
      isQuiescent: false,
      hasPendingTasks: false,
      ...overrides,
    };
  }

  it('transitions active → idle when quiescent', () => {
    expect(agyPollState(makePollCtx({ status: 'active', isQuiescent: true }))).toEqual({
      status: 'idle',
      attention: { level: 'action', reason: 'Antigravity finished — awaiting input' },
    });
  });

  it('returns idle without attention when pending tasks exist', () => {
    expect(agyPollState(makePollCtx({ status: 'active', isQuiescent: true, hasPendingTasks: true })))
      .toEqual({ status: 'idle' });
  });

  it('detects permission prompts before the idle fallback', () => {
    expect(agyPollState(makePollCtx({
      status: 'active',
      buffer: 'Allow once\nDeny once\nAllow always\n',
      isQuiescent: true,
    }))).toEqual({
      status: 'waiting',
      attention: { level: 'action', reason: 'Permission prompt detected' },
    });
  });

  it('does not re-trigger permission detection when action attention is already set', () => {
    expect(agyPollState(makePollCtx({
      status: 'active',
      attentionLevel: 'action',
      buffer: 'Allow once\nDeny once\nAllow always\n',
      isQuiescent: true,
    }))).toEqual({
      status: 'idle',
      attention: { level: 'action', reason: 'Antigravity finished — awaiting input' },
    });
  });

  it('returns null when active but not quiescent', () => {
    expect(agyPollState(makePollCtx({ status: 'active', isQuiescent: false }))).toBeNull();
  });

  it('returns null when already idle', () => {
    expect(agyPollState(makePollCtx({ status: 'idle', isQuiescent: true }))).toBeNull();
  });

  it('returns null when ended', () => {
    expect(agyPollState(makePollCtx({ status: 'ended', isQuiescent: true }))).toBeNull();
  });
});

describe('agy-runtime adapter', () => {
  it('wires prepareCreate and pollState', () => {
    const adapter = createAgyRuntimeAdapter();
    expect(adapter.sessionType).toBe('agy');
    expect(adapter.prepareCreate).toBeDefined();
    expect(adapter.pollState).toBe(agyPollState);
  });

  it('does not expose resume or post-create capture in v1 (launch-only)', () => {
    const adapter = createAgyRuntimeAdapter();
    expect(adapter.prepareResume).toBeUndefined();
    expect(adapter.afterCreate).toBeUndefined();
  });
});
