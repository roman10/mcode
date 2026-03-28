import { describe, expect, it, vi } from 'vitest';
import {
  buildCodexCreatePlan,
  buildCodexResumePlan,
  codexPollState,
  createCodexRuntimeAdapter,
  isCodexCommand,
} from '../../../src/main/session/agent-runtimes/codex-runtime';
import type { PtyPollContext } from '../../../src/main/session/agent-runtime';

describe('isCodexCommand', () => {
  it('recognizes standard codex binary names', () => {
    expect(isCodexCommand('codex')).toBe(true);
    expect(isCodexCommand('/usr/local/bin/codex')).toBe(true);
    expect(isCodexCommand('codex.exe')).toBe(true);
  });
  it('rejects non-codex binaries', () => {
    expect(isCodexCommand('claude')).toBe(false);
    expect(isCodexCommand('node')).toBe(false);
  });
});

describe('buildCodexCreatePlan', () => {
  it('produces live hook mode with bridge ready', () => {
    expect(buildCodexCreatePlan({
      input: { cwd: '/repo', sessionType: 'codex', initialPrompt: 'inspect' },
      command: 'codex',
      hookRuntime: { state: 'ready', port: 4312, warning: null },
      agentHookBridgeReady: true,
    })).toEqual({
      hookMode: 'live',
      args: ['--enable', 'codex_hooks', 'inspect'],
      env: { MCODE_HOOK_PORT: '4312' },
      dbFields: {},
    });
  });

  it('falls back when bridge is not ready', () => {
    expect(buildCodexCreatePlan({
      input: { cwd: '/repo', sessionType: 'codex', initialPrompt: 'inspect' },
      command: 'codex',
      hookRuntime: { state: 'ready', port: 4312, warning: null },
      agentHookBridgeReady: false,
    })).toEqual({
      hookMode: 'fallback',
      args: ['inspect'],
      env: {},
      dbFields: {},
    });
  });

  it('omits args when no initial prompt', () => {
    const result = buildCodexCreatePlan({
      input: { cwd: '/repo', sessionType: 'codex' },
      command: 'codex',
      hookRuntime: { state: 'ready', port: 4312, warning: null },
      agentHookBridgeReady: false,
    });
    expect(result.args).toEqual([]);
  });

  it('falls back when command is not a recognized codex binary', () => {
    const result = buildCodexCreatePlan({
      input: { cwd: '/repo', sessionType: 'codex', initialPrompt: 'inspect' },
      command: '/custom/my-codex-wrapper',
      hookRuntime: { state: 'ready', port: 4312, warning: null },
      agentHookBridgeReady: true,
    });
    expect(result.hookMode).toBe('fallback');
    expect(result.args).toEqual(['inspect']);
    expect(result.env).toEqual({});
  });

  it('includes MCODE_HOOK_PORT env only when bridge ready and port available', () => {
    const result = buildCodexCreatePlan({
      input: { cwd: '/repo', sessionType: 'codex' },
      command: 'codex',
      hookRuntime: { state: 'ready', port: null, warning: null },
      agentHookBridgeReady: true,
    });
    expect(result.env).toEqual({});
  });
});

describe('codex-runtime', () => {
  it('builds a live resume plan when the Codex hook bridge is ready', () => {
    expect(buildCodexResumePlan({
      sessionId: 'session-1',
      row: {
        command: 'codex',
        cwd: '/tmp/project',
        codexThreadId: 'thread-123',
        geminiSessionId: null,
        claudeSessionId: null,
        permissionMode: null,
        effort: null,
        enableAutoMode: false,
        allowBypassPermissions: false,
        worktree: null,
      },
      hookRuntime: {
        state: 'ready',
        port: 4312,
        warning: null,
      },
      agentHookBridgeReady: true,
    })).toEqual({
      command: 'codex',
      cwd: '/tmp/project',
      args: ['--enable', 'codex_hooks', 'resume', 'thread-123'],
      env: { MCODE_HOOK_PORT: '4312' },
      hookMode: 'live',
      logLabel: 'Codex',
      logContext: {
        codexThreadId: 'thread-123',
        cwd: '/tmp/project',
        hookMode: 'live',
      },
    });
  });

  it('falls back when the Codex hook bridge is unavailable', () => {
    expect(buildCodexResumePlan({
      sessionId: 'session-1',
      row: {
        command: null,
        cwd: '/tmp/project',
        codexThreadId: 'thread-123',
        geminiSessionId: null,
        claudeSessionId: null,
        permissionMode: null,
        effort: null,
        enableAutoMode: false,
        allowBypassPermissions: false,
        worktree: null,
      },
      hookRuntime: {
        state: 'degraded',
        port: 4312,
        warning: 'bridge unavailable',
      },
      agentHookBridgeReady: false,
    })).toEqual({
      command: 'codex',
      cwd: '/tmp/project',
      args: ['resume', 'thread-123'],
      env: {},
      hookMode: 'fallback',
      logLabel: 'Codex',
      logContext: {
        codexThreadId: 'thread-123',
        cwd: '/tmp/project',
        hookMode: 'fallback',
      },
    });
  });

  it('requires a stored thread id', () => {
    expect(() => buildCodexResumePlan({
      sessionId: 'session-1',
      row: {
        command: 'codex',
        cwd: '/tmp/project',
        codexThreadId: null,
        geminiSessionId: null,
      },
      hookRuntime: {
        state: 'ready',
        port: 4312,
        warning: null,
      },
      agentHookBridgeReady: true,
    })).toThrow('Cannot resume: no Codex thread ID recorded');
  });

  it('wires pollState into the adapter', () => {
    const adapter = createCodexRuntimeAdapter({ scheduleThreadCapture: vi.fn() });
    expect(adapter.pollState).toBe(codexPollState);
    expect(adapter.prepareCreate).toBeDefined();
  });

  it('delegates post-create capture scheduling through the adapter', () => {
    const scheduleThreadCapture = vi.fn();
    const adapter = createCodexRuntimeAdapter({ scheduleThreadCapture });

    adapter.afterCreate?.({
      sessionId: 'session-1',
      cwd: '/tmp/project',
      startedAt: '2025-01-01T00:00:00.000Z',
      command: 'codex',
      initialPrompt: 'Investigate failing test',
    });

    expect(scheduleThreadCapture).toHaveBeenCalledWith({
      sessionId: 'session-1',
      cwd: '/tmp/project',
      startedAt: '2025-01-01T00:00:00.000Z',
      initialPrompt: 'Investigate failing test',
    });
  });
});

describe('codexPollState', () => {
  function ctx(overrides: Partial<PtyPollContext> = {}): PtyPollContext {
    return {
      sessionId: 'codex-session',
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

  it('transitions active to idle with attention when quiescent', () => {
    expect(codexPollState(ctx({ status: 'active', isQuiescent: true }))).toEqual({
      status: 'idle',
      attention: { level: 'action', reason: 'Codex finished — awaiting input' },
    });
  });

  it('returns null when active but not quiescent', () => {
    expect(codexPollState(ctx({ status: 'active', isQuiescent: false }))).toBeNull();
  });

  it('returns null when idle', () => {
    expect(codexPollState(ctx({ status: 'idle', isQuiescent: true }))).toBeNull();
  });

  it('returns null when waiting', () => {
    expect(codexPollState(ctx({ status: 'waiting', isQuiescent: true }))).toBeNull();
  });
});