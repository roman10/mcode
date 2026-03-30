import { describe, expect, it, vi } from 'vitest';
import {
  buildGeminiCreatePlan,
  buildGeminiResumePlan,
  createGeminiRuntimeAdapter,
  geminiPollState,
  isGeminiCommand,
} from '../../../src/main/session/agent-runtimes/gemini-runtime';
import type { PtyPollContext } from '../../../src/main/session/agent-runtime';

describe('isGeminiCommand', () => {
  it('recognizes standard gemini binary names', () => {
    expect(isGeminiCommand('gemini')).toBe(true);
    expect(isGeminiCommand('/usr/local/bin/gemini')).toBe(true);
    expect(isGeminiCommand('gemini.exe')).toBe(true);
  });
  it('rejects non-gemini binaries', () => {
    expect(isGeminiCommand('claude')).toBe(false);
    expect(isGeminiCommand('codex')).toBe(false);
    expect(isGeminiCommand('node')).toBe(false);
  });
});

describe('buildGeminiResumePlan', () => {
  it('builds a live resume plan when bridge is ready', () => {
    expect(buildGeminiResumePlan({
      sessionId: 'session-1',
      row: {
        command: 'gemini',
        cwd: '/tmp/project',
        codexThreadId: null,
        claudeSessionId: null,
        permissionMode: null,
        effort: null,
        enableAutoMode: false,
        allowBypassPermissions: false,
        worktree: null,
        geminiSessionId: 'gemini-session-123',
      },
      hookRuntime: {
        state: 'ready',
        port: 4312,
        warning: null,
      },
      agentHookBridgeReady: true,
    }, {
      listSessions: () => [
        {
          index: 7,
          title: 'Investigate failing test',
          relativeAgeText: 'just now',
          geminiSessionId: 'gemini-session-123',
        },
      ],
    })).toEqual({
      command: 'gemini',
      cwd: '/tmp/project',
      args: ['--resume', '7'],
      env: { MCODE_HOOK_PORT: '4312' },
      hookMode: 'live',
      logLabel: 'Gemini',
      logContext: {
        geminiSessionId: 'gemini-session-123',
        cwd: '/tmp/project',
        resumeIndex: 7,
        hookMode: 'live',
      },
    });
  });

  it('falls back when bridge is not ready', () => {
    expect(buildGeminiResumePlan({
      sessionId: 'session-1',
      row: {
        command: 'gemini',
        cwd: '/tmp/project',
        codexThreadId: null,
        claudeSessionId: null,
        permissionMode: null,
        effort: null,
        enableAutoMode: false,
        allowBypassPermissions: false,
        worktree: null,
        geminiSessionId: 'gemini-session-123',
      },
      hookRuntime: {
        state: 'degraded',
        port: null,
        warning: 'bridge unavailable',
      },
      agentHookBridgeReady: false,
    }, {
      listSessions: () => [
        {
          index: 7,
          title: 'Investigate failing test',
          relativeAgeText: 'just now',
          geminiSessionId: 'gemini-session-123',
        },
      ],
    })).toEqual({
      command: 'gemini',
      cwd: '/tmp/project',
      args: ['--resume', '7'],
      env: {},
      hookMode: 'fallback',
      logLabel: 'Gemini',
      logContext: {
        geminiSessionId: 'gemini-session-123',
        cwd: '/tmp/project',
        resumeIndex: 7,
        hookMode: 'fallback',
      },
    });
  });

  it('requires a stored Gemini session id', () => {
    expect(() => buildGeminiResumePlan({
      sessionId: 'session-1',
      row: {
        command: 'gemini',
        cwd: '/tmp/project',
        codexThreadId: null,
        claudeSessionId: null,
        permissionMode: null,
        effort: null,
        enableAutoMode: false,
        allowBypassPermissions: false,
        worktree: null,
        geminiSessionId: null,
      },
      hookRuntime: {
        state: 'ready',
        port: 4312,
        warning: null,
      },
      agentHookBridgeReady: true,
    }, {
      listSessions: () => [],
    })).toThrow('Cannot resume: no Gemini session ID recorded');
  });

  it('surfaces a clear error with available IDs when the stored Gemini session is missing', () => {
    expect(() => buildGeminiResumePlan({
      sessionId: 'session-1',
      row: {
        command: null,
        cwd: '/tmp/project',
        codexThreadId: null,
        claudeSessionId: null,
        permissionMode: null,
        effort: null,
        enableAutoMode: false,
        allowBypassPermissions: false,
        worktree: null,
        geminiSessionId: 'missing-id',
      },
      hookRuntime: {
        state: 'ready',
        port: 4312,
        warning: null,
      },
      agentHookBridgeReady: true,
    }, {
      listSessions: () => [
        {
          index: 1,
          title: 'Other session',
          relativeAgeText: '1m ago',
          geminiSessionId: 'other-id',
        },
        {
          index: 2,
          title: 'Another session',
          relativeAgeText: '5m ago',
          geminiSessionId: 'another-id',
        },
      ],
    })).toThrow('Gemini session missing-id is no longer available in the session list. Found 2 session(s): other-id, another-id.');
  });

  it('shows empty session count when no sessions are listed', () => {
    expect(() => buildGeminiResumePlan({
      sessionId: 'session-1',
      row: {
        command: null,
        cwd: '/tmp/project',
        codexThreadId: null,
        claudeSessionId: null,
        permissionMode: null,
        effort: null,
        enableAutoMode: false,
        allowBypassPermissions: false,
        worktree: null,
        geminiSessionId: 'missing-id',
      },
      hookRuntime: {
        state: 'ready',
        port: 4312,
        warning: null,
      },
      agentHookBridgeReady: true,
    }, {
      listSessions: () => [],
    })).toThrow('Gemini session missing-id is no longer available in the session list. Found 0 session(s).');
  });
});

describe('buildGeminiCreatePlan', () => {
  it('produces live hook mode with bridge ready', () => {
    expect(buildGeminiCreatePlan({
      input: { cwd: '/repo', sessionType: 'gemini', model: 'gemini-2.5-pro', initialPrompt: 'inspect' },
      command: 'gemini',
      hookRuntime: { state: 'ready', port: 4312, warning: null },
      agentHookBridgeReady: true,
    })).toEqual({
      hookMode: 'live',
      args: ['--model', 'gemini-2.5-pro', 'inspect'],
      env: { MCODE_HOOK_PORT: '4312' },
      dbFields: { model: 'gemini-2.5-pro' },
    });
  });

  it('falls back when bridge is not ready', () => {
    const result = buildGeminiCreatePlan({
      input: { cwd: '/repo', sessionType: 'gemini', model: 'gemini-2.5-pro', initialPrompt: 'inspect' },
      command: 'gemini',
      hookRuntime: { state: 'ready', port: 4312, warning: null },
      agentHookBridgeReady: false,
    });
    expect(result.hookMode).toBe('fallback');
    expect(result.env).toEqual({});
  });

  it('falls back when command is not a recognized gemini binary', () => {
    const result = buildGeminiCreatePlan({
      input: { cwd: '/repo', sessionType: 'gemini', initialPrompt: 'inspect' },
      command: '/custom/my-gemini-wrapper',
      hookRuntime: { state: 'ready', port: 4312, warning: null },
      agentHookBridgeReady: true,
    });
    expect(result.hookMode).toBe('fallback');
    expect(result.env).toEqual({});
  });

  it('handles missing model and prompt', () => {
    const result = buildGeminiCreatePlan({
      input: { cwd: '/repo', sessionType: 'gemini' },
      command: 'gemini',
      hookRuntime: { state: 'ready', port: 4312, warning: null },
      agentHookBridgeReady: false,
    });
    expect(result.args).toEqual([]);
    expect(result.dbFields).toEqual({ model: null });
  });

  it('includes MCODE_HOOK_PORT env only when bridge ready and port available', () => {
    const result = buildGeminiCreatePlan({
      input: { cwd: '/repo', sessionType: 'gemini' },
      command: 'gemini',
      hookRuntime: { state: 'ready', port: null, warning: null },
      agentHookBridgeReady: true,
    });
    expect(result.env).toEqual({});
  });
});

describe('gemini-runtime adapter', () => {
  it('delegates post-create capture scheduling and list lookup through the adapter', () => {
    const scheduleSessionCapture = vi.fn();
    const listSessions = vi.fn().mockReturnValue([
      {
        index: 3,
        title: 'Investigate failing test',
        relativeAgeText: 'just now',
        geminiSessionId: 'gemini-session-123',
      },
    ]);
    const adapter = createGeminiRuntimeAdapter({
      scheduleSessionCapture,
      listSessions,
    });

    adapter.afterCreate?.({
      sessionId: 'session-1',
      cwd: '/tmp/project',
      startedAt: '2025-01-01T00:00:00.000Z',
      command: 'gemini',
      initialPrompt: 'Investigate failing test',
    });

    expect(scheduleSessionCapture).toHaveBeenCalledWith({
      sessionId: 'session-1',
      cwd: '/tmp/project',
      command: 'gemini',
      initialPrompt: 'Investigate failing test',
    });

    expect(adapter.prepareResume({
      sessionId: 'session-1',
      row: {
        command: 'gemini',
        cwd: '/tmp/project',
        codexThreadId: null,
        claudeSessionId: null,
        permissionMode: null,
        effort: null,
        enableAutoMode: false,
        allowBypassPermissions: false,
        worktree: null,
        geminiSessionId: 'gemini-session-123',
      },
      hookRuntime: {
        state: 'ready',
        port: 4312,
        warning: null,
      },
      agentHookBridgeReady: true,
    }).args).toEqual(['--resume', '3']);

    expect(listSessions).toHaveBeenCalledWith('gemini', '/tmp/project');

    expect(adapter.prepareCreate).toBeDefined();
    expect(adapter.pollState).toBe(geminiPollState);
  });
});

describe('geminiPollState', () => {
  function ctx(overrides: Partial<PtyPollContext> = {}): PtyPollContext {
    return {
      sessionId: 'gemini-session',
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
    expect(geminiPollState(ctx({ status: 'active', isQuiescent: true }))).toEqual({
      status: 'idle',
      attention: { level: 'action', reason: 'Gemini finished — awaiting input' },
    });
  });

  it('detects permission prompts before idle fallback', () => {
    expect(geminiPollState(ctx({
      status: 'active',
      buffer: 'Allow once\nDeny once\nAllow always\n',
      isQuiescent: true,
    }))).toEqual({
      status: 'waiting',
      attention: { level: 'action', reason: 'Permission prompt detected' },
    });
  });

  it('does not re-trigger permission detection when action attention is already set', () => {
    expect(geminiPollState(ctx({
      status: 'active',
      attentionLevel: 'action',
      buffer: 'Allow once\nDeny once\nAllow always\n',
      isQuiescent: true,
    }))).toEqual({
      status: 'idle',
      attention: { level: 'action', reason: 'Gemini finished — awaiting input' },
    });
  });

  it('returns null when active but not quiescent', () => {
    expect(geminiPollState(ctx({ status: 'active', isQuiescent: false }))).toBeNull();
  });

  it('returns null when idle', () => {
    expect(geminiPollState(ctx({ status: 'idle', isQuiescent: true }))).toBeNull();
  });

  it('returns null when waiting', () => {
    expect(geminiPollState(ctx({ status: 'waiting', isQuiescent: true }))).toBeNull();
  });
});
