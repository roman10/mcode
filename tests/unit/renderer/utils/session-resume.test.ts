import { describe, expect, it } from 'vitest';
import { canResumeSession } from '../../../../src/renderer/utils/session-resume';
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
});
