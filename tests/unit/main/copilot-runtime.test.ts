import { describe, it, expect } from 'vitest';
import {
  buildCopilotCreatePlan,
  isCopilotCommand,
  copilotPollState,
} from '../../../src/main/session/agent-runtimes/copilot-runtime';
import type { AgentCreateContext, PtyPollContext } from '../../../src/main/session/agent-runtime';

function makeCreateCtx(overrides?: Partial<AgentCreateContext['input']>): AgentCreateContext {
  return {
    input: {
      cwd: '/tmp',
      ...overrides,
    },
    command: 'copilot',
    hookRuntime: { state: 'initializing', port: null, warning: null },
    agentHookBridgeReady: false,
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
