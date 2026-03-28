import { describe, expect, it } from 'vitest';
import {
  canDisplaySessionModel,
  canSessionBeDefaultTaskTarget,
  canSessionBeTaskTarget,
  canSessionQueueTasks,
  getSessionInstallHelp,
} from '../../../src/shared/session-capabilities';
import { makeSession } from '../test-factories';

describe('session-capabilities', () => {
  it('allows live Claude sessions to queue tasks', () => {
    expect(canSessionQueueTasks(makeSession())).toBe(true);
    expect(canSessionBeTaskTarget(makeSession({ status: 'idle' }))).toBe(true);
    expect(canSessionBeDefaultTaskTarget(makeSession({ status: 'active' }))).toBe(true);
  });

  it('blocks non-live or ended sessions from task targeting', () => {
    expect(canSessionQueueTasks(makeSession({ hookMode: 'fallback' }))).toBe(false);
    expect(canSessionQueueTasks(makeSession({ status: 'ended' }))).toBe(false);
    expect(canSessionBeTaskTarget(makeSession({ status: 'waiting' }))).toBe(false);
    expect(canSessionQueueTasks(makeSession({ sessionType: 'gemini', hookMode: 'fallback' }))).toBe(false);
    expect(canSessionBeDefaultTaskTarget(makeSession({ status: 'starting' }))).toBe(false);
  });

  it('shows model pills only for agents that support model display', () => {
    expect(canDisplaySessionModel(makeSession({ model: 'claude-sonnet-4-5' }))).toBe(true);
    expect(canDisplaySessionModel(makeSession({ sessionType: 'gemini', model: 'gemini-2.5-pro' }))).toBe(false);
    expect(canDisplaySessionModel(makeSession({ model: null }))).toBe(false);
  });

  it('returns install help only for agents with an install URL', () => {
    expect(getSessionInstallHelp('claude')).toEqual({
      command: 'claude',
      displayName: 'Claude Code',
      url: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    });
    expect(getSessionInstallHelp('codex')).toBeNull();
    expect(getSessionInstallHelp('gemini')).toBeNull();
  });
});