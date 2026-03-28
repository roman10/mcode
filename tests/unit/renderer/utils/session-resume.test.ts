import { describe, expect, it } from 'vitest';
import {
  buildStartNewSessionInput,
  canOverrideResumeAccount,
  canResumeSession,
  getResumeUnavailableMessage,
} from '../../../../src/renderer/utils/session-resume';
import { makeSession } from '../../test-factories';

describe('canResumeSession', () => {
  it('returns true for Claude sessions with a Claude session ID', () => {
    expect(canResumeSession(makeSession({
      sessionType: 'claude',
      claudeSessionId: 'claude-session-123',
    }))).toBe(true);
  });

  it('returns true for Codex sessions with a Codex thread ID', () => {
    expect(canResumeSession(makeSession({
      sessionType: 'codex',
      codexThreadId: 'thread-123',
    }))).toBe(true);
  });

  it('returns false when the session has no persisted resume identity', () => {
    expect(canResumeSession(makeSession({
      sessionType: 'claude',
      claudeSessionId: null,
    }))).toBe(false);

    expect(canResumeSession(makeSession({
      sessionType: 'codex',
      codexThreadId: null,
    }))).toBe(false);
  });

  it('returns false for terminal sessions', () => {
    expect(canResumeSession(makeSession({
      sessionType: 'terminal',
      claudeSessionId: 'ignored',
      codexThreadId: 'ignored',
    }))).toBe(false);
  });

  it('returns a helpful message when resume identity is missing', () => {
    expect(getResumeUnavailableMessage(makeSession({
      sessionType: 'claude',
      claudeSessionId: null,
    }))).toBe('No Claude session ID recorded — cannot resume');

    expect(getResumeUnavailableMessage(makeSession({
      sessionType: 'codex',
      codexThreadId: null,
    }))).toBe('No Codex thread ID recorded — cannot resume');
  });

  it('uses agent metadata to decide account override support', () => {
    expect(canOverrideResumeAccount(makeSession({ sessionType: 'claude' }))).toBe(true);
    expect(canOverrideResumeAccount(makeSession({ sessionType: 'codex' }))).toBe(false);
    expect(canOverrideResumeAccount(makeSession({ sessionType: 'terminal' }))).toBe(false);
  });

  it('builds new-session inputs from agent dialog mode', () => {
    expect(buildStartNewSessionInput(makeSession({ sessionType: 'codex' }), 'ignored')).toEqual({
      cwd: '/tmp/test',
      sessionType: 'codex',
    });

    expect(buildStartNewSessionInput(makeSession({
      sessionType: 'claude',
      permissionMode: 'auto',
    }), 'acct-1')).toEqual({
      cwd: '/tmp/test',
      permissionMode: 'auto',
      sessionType: 'claude',
      accountId: 'acct-1',
    });
  });
});
