import { describe, it, expect, vi } from 'vitest';
import {
  buildCopilotCreatePlan,
  buildCopilotResumePlan,
  isCopilotCommand,
  copilotPollState,
  createCopilotRuntimeAdapter,
} from '../../../src/main/session/agent-runtimes/copilot-runtime';
import type { AgentCreateContext, AgentPrepareResumeContext, PtyPollContext } from '../../../src/main/session/agent-runtime';

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
    command: command ?? 'copilot',
    hookRuntime: hookReady
      ? { state: 'ready', port: hookPort ?? 7777, warning: null }
      : { state: 'initializing', port: null, warning: null },
    agentHookBridgeReady: hookReady ?? false,
  };
}

function makeResumeCtx(overrides?: Partial<AgentPrepareResumeContext['row']> & {
  hookReady?: boolean;
  hookPort?: number;
}): AgentPrepareResumeContext {
  const { hookReady, hookPort, ...rowOverrides } = overrides ?? {};
  return {
    sessionId: 'test-session',
    row: {
      command: 'copilot',
      cwd: '/tmp/project',
      codexThreadId: null,
      geminiSessionId: null,
      claudeSessionId: null,
      copilotSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      permissionMode: null,
      effort: null,
      enableAutoMode: false,
      allowBypassPermissions: false,
      worktree: null,
      ...rowOverrides,
    },
    hookRuntime: hookReady
      ? { state: 'ready', port: hookPort ?? 7777, warning: null }
      : { state: 'initializing', port: null, warning: null },
    agentHookBridgeReady: hookReady ?? false,
  };
}

describe('isCopilotCommand', () => {
  it('matches "copilot"', () => {
    expect(isCopilotCommand('copilot')).toBe(true);
  });

  it('matches "copilot.exe"', () => {
    expect(isCopilotCommand('copilot.exe')).toBe(true);
  });

  it('matches absolute path to copilot', () => {
    expect(isCopilotCommand('/usr/bin/copilot')).toBe(true);
  });

  it('does not match unrelated commands', () => {
    expect(isCopilotCommand('not-copilot')).toBe(false);
    expect(isCopilotCommand('claude')).toBe(false);
    expect(isCopilotCommand('gemini')).toBe(false);
  });
});

describe('buildCopilotCreatePlan', () => {
  it('produces bare launch with no options', () => {
    const plan = buildCopilotCreatePlan(makeCreateCtx());
    expect(plan.hookMode).toBe('fallback');
    expect(plan.args).toEqual([]);
    expect(plan.env).toEqual({});
    expect(plan.dbFields.model).toBeNull();
  });

  it('passes --model when model is provided', () => {
    const plan = buildCopilotCreatePlan(makeCreateCtx({ model: 'gpt-4.1' }));
    expect(plan.args).toEqual(['--model', 'gpt-4.1']);
    expect(plan.dbFields.model).toBe('gpt-4.1');
  });

  it('passes -i when initialPrompt is provided', () => {
    const plan = buildCopilotCreatePlan(makeCreateCtx({ initialPrompt: 'review the code' }));
    expect(plan.args).toEqual(['-i', 'review the code']);
  });

  it('passes both --model and -i when both provided', () => {
    const plan = buildCopilotCreatePlan(makeCreateCtx({
      model: 'gpt-4.1',
      initialPrompt: 'fix bugs',
    }));
    expect(plan.args).toEqual(['--model', 'gpt-4.1', '-i', 'fix bugs']);
    expect(plan.dbFields.model).toBe('gpt-4.1');
  });

  it('trims whitespace-only model to null and omits --model arg', () => {
    const plan = buildCopilotCreatePlan(makeCreateCtx({ model: '  ' }));
    expect(plan.dbFields.model).toBeNull();
    expect(plan.args).toEqual([]);
  });

  it('uses hookMode live and sets MCODE_HOOK_PORT when hooks are ready', () => {
    const plan = buildCopilotCreatePlan(makeCreateCtx({ hookReady: true, hookPort: 7779 }));
    expect(plan.hookMode).toBe('live');
    expect(plan.env).toEqual({ MCODE_HOOK_PORT: '7779' });
  });

  it('falls back to hookMode fallback when bridge is not ready', () => {
    const plan = buildCopilotCreatePlan(makeCreateCtx({ hookReady: false }));
    expect(plan.hookMode).toBe('fallback');
    expect(plan.env).toEqual({});
  });

  it('falls back when command is not copilot even if bridge ready', () => {
    const plan = buildCopilotCreatePlan(makeCreateCtx({
      hookReady: true,
      hookPort: 7777,
      command: '/usr/bin/my-wrapper',
    }));
    expect(plan.hookMode).toBe('fallback');
    expect(plan.env).toEqual({});
  });
});

describe('buildCopilotResumePlan', () => {
  it('produces --resume <UUID> with correct args', () => {
    const plan = buildCopilotResumePlan(makeResumeCtx());
    expect(plan.command).toBe('copilot');
    expect(plan.args).toEqual(['--resume', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
    expect(plan.cwd).toBe('/tmp/project');
    expect(plan.logLabel).toBe('Copilot');
    expect(plan.logContext).toEqual({
      copilotSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      cwd: '/tmp/project',
      hookMode: 'fallback',
    });
  });

  it('uses hookMode live when hooks are ready', () => {
    const plan = buildCopilotResumePlan(makeResumeCtx({ hookReady: true, hookPort: 7780 }));
    expect(plan.hookMode).toBe('live');
    expect(plan.env).toEqual({ MCODE_HOOK_PORT: '7780' });
  });

  it('uses hookMode fallback when hooks are not ready', () => {
    const plan = buildCopilotResumePlan(makeResumeCtx({ hookReady: false }));
    expect(plan.hookMode).toBe('fallback');
    expect(plan.env).toEqual({});
  });

  it('throws when copilotSessionId is null', () => {
    expect(() => buildCopilotResumePlan(makeResumeCtx({ copilotSessionId: null }))).toThrow(
      'Cannot resume: no Copilot session ID recorded',
    );
  });

  it('uses stored command from row', () => {
    const plan = buildCopilotResumePlan(makeResumeCtx({ command: '/usr/local/bin/copilot' }));
    expect(plan.command).toBe('/usr/local/bin/copilot');
  });

  it('defaults to copilot when row.command is null', () => {
    const plan = buildCopilotResumePlan(makeResumeCtx({ command: null }));
    expect(plan.command).toBe('copilot');
  });
});

describe('copilot-runtime adapter', () => {
  it('wires pollState and prepare methods into the adapter', () => {
    const adapter = createCopilotRuntimeAdapter({ scheduleSessionCapture: vi.fn() });
    expect(adapter.pollState).toBe(copilotPollState);
    expect(adapter.prepareCreate).toBeDefined();
    expect(adapter.prepareResume).toBeDefined();
  });

  it('delegates post-create capture scheduling through the adapter', () => {
    const scheduleSessionCapture = vi.fn();
    const adapter = createCopilotRuntimeAdapter({ scheduleSessionCapture });

    adapter.afterCreate?.({
      sessionId: 'session-1',
      cwd: '/tmp/project',
      startedAt: '2025-01-01T00:00:00.000Z',
      command: 'copilot',
      initialPrompt: 'fix the tests',
    });

    expect(scheduleSessionCapture).toHaveBeenCalledWith({
      sessionId: 'session-1',
      cwd: '/tmp/project',
      startedAt: '2025-01-01T00:00:00.000Z',
      initialPrompt: 'fix the tests',
    });
  });
});

describe('copilotPollState', () => {
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
    const result = copilotPollState(makePollCtx({ status: 'active', isQuiescent: true }));
    expect(result).toEqual({
      status: 'idle',
      attention: { level: 'action', reason: 'Copilot finished — awaiting input' },
    });
  });

  it('detects permission prompts before idle fallback', () => {
    expect(copilotPollState(makePollCtx({
      status: 'active',
      buffer: 'Allow once\nDeny once\nAllow always\n',
      isQuiescent: true,
    }))).toEqual({
      status: 'waiting',
      attention: { level: 'action', reason: 'Permission prompt detected' },
    });
  });

  it('does not re-trigger permission detection when action attention is already set', () => {
    expect(copilotPollState(makePollCtx({
      status: 'active',
      attentionLevel: 'action',
      buffer: 'Allow once\nDeny once\nAllow always\n',
      isQuiescent: true,
    }))).toEqual({
      status: 'idle',
      attention: { level: 'action', reason: 'Copilot finished — awaiting input' },
    });
  });

  it('returns null when active but not quiescent', () => {
    expect(copilotPollState(makePollCtx({ status: 'active', isQuiescent: false }))).toBeNull();
  });

  it('returns null when already idle', () => {
    expect(copilotPollState(makePollCtx({ status: 'idle', isQuiescent: true }))).toBeNull();
  });

  it('returns null when ended', () => {
    expect(copilotPollState(makePollCtx({ status: 'ended', isQuiescent: true }))).toBeNull();
  });
});
