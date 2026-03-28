import { describe, expect, it, vi } from 'vitest';
import {
  buildGeminiResumePlan,
  createGeminiRuntimeAdapter,
} from '../../../src/main/session/agent-runtimes/gemini-runtime';

describe('gemini-runtime', () => {
  it('builds a fallback resume plan from the stored Gemini session id', () => {
    expect(buildGeminiResumePlan({
      sessionId: 'session-1',
      row: {
        command: 'gemini',
        cwd: '/tmp/project',
        codexThreadId: null,
        geminiSessionId: 'gemini-session-123',
      },
      hookRuntime: {
        state: 'ready',
        port: 4312,
        warning: null,
      },
      codexBridgeReady: true,
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
        geminiSessionId: null,
      },
      hookRuntime: {
        state: 'ready',
        port: 4312,
        warning: null,
      },
      codexBridgeReady: true,
    }, {
      listSessions: () => [],
    })).toThrow('Cannot resume: no Gemini session ID recorded');
  });

  it('surfaces a clear error when the stored Gemini session is missing from the list', () => {
    expect(() => buildGeminiResumePlan({
      sessionId: 'session-1',
      row: {
        command: null,
        cwd: '/tmp/project',
        codexThreadId: null,
        geminiSessionId: 'missing-id',
      },
      hookRuntime: {
        state: 'ready',
        port: 4312,
        warning: null,
      },
      codexBridgeReady: true,
    }, {
      listSessions: () => [
        {
          index: 1,
          title: 'Other session',
          relativeAgeText: '1m ago',
          geminiSessionId: 'other-id',
        },
      ],
    })).toThrow('Cannot resume: stored Gemini session ID is no longer available in Gemini session list');
  });

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
        geminiSessionId: 'gemini-session-123',
      },
      hookRuntime: {
        state: 'ready',
        port: 4312,
        warning: null,
      },
      codexBridgeReady: true,
    }).args).toEqual(['--resume', '3']);

    expect(listSessions).toHaveBeenCalledWith('gemini', '/tmp/project');
  });
});