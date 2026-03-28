import { describe, expect, it, vi } from 'vitest';
import {
  buildCodexResumePlan,
  createCodexRuntimeAdapter,
} from '../../../src/main/session/agent-runtimes/codex-runtime';

describe('codex-runtime', () => {
  it('builds a live resume plan when the Codex hook bridge is ready', () => {
    expect(buildCodexResumePlan({
      sessionId: 'session-1',
      row: {
        command: 'codex',
        cwd: '/tmp/project',
        codexThreadId: 'thread-123',
        geminiSessionId: null,
      },
      hookRuntime: {
        state: 'ready',
        port: 4312,
        warning: null,
      },
      codexBridgeReady: true,
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
      },
      hookRuntime: {
        state: 'degraded',
        port: 4312,
        warning: 'bridge unavailable',
      },
      codexBridgeReady: false,
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
      codexBridgeReady: true,
    })).toThrow('Cannot resume: no Codex thread ID recorded');
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