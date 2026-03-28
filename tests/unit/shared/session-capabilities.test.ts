import { describe, expect, it } from 'vitest';
import {
  canDisplaySessionModel,
  canSessionBeDefaultTaskTarget,
  canSessionBeTaskTarget,
  canSessionQueueTasks,
  getSessionInstallHelp,
  hasLiveTaskQueue,
} from '../../../src/shared/session-capabilities';
import { getAgentDefinition } from '../../../src/shared/session-agents';
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

  it('allows live Gemini sessions to queue tasks (WP1)', () => {
    expect(hasLiveTaskQueue(makeSession({ sessionType: 'gemini', hookMode: 'live' }))).toBe(true);
    expect(canSessionQueueTasks(makeSession({ sessionType: 'gemini', hookMode: 'live' }))).toBe(true);
    expect(canSessionBeTaskTarget(makeSession({ sessionType: 'gemini', hookMode: 'live', status: 'idle' }))).toBe(true);
  });

  it('blocks fallback Gemini sessions from task queue', () => {
    expect(hasLiveTaskQueue(makeSession({ sessionType: 'gemini', hookMode: 'fallback' }))).toBe(false);
    expect(canSessionQueueTasks(makeSession({ sessionType: 'gemini', hookMode: 'fallback' }))).toBe(false);
  });

  it('hasLiveTaskQueue does not gate on session status', () => {
    // hasLiveTaskQueue checks agent support + hookMode only, not status —
    // this is critical so ended sessions can reach the resume path in TaskQueue.create()
    expect(hasLiveTaskQueue(makeSession({ sessionType: 'gemini', hookMode: 'live', status: 'ended' }))).toBe(true);
    expect(hasLiveTaskQueue(makeSession({ sessionType: 'claude', hookMode: 'live', status: 'ended' }))).toBe(true);
  });

  it('shows model pills only for agents that support model display', () => {
    expect(canDisplaySessionModel(makeSession({ model: 'claude-sonnet-4-5' }))).toBe(true);
    expect(canDisplaySessionModel(makeSession({ sessionType: 'gemini', model: 'gemini-2.5-pro' }))).toBe(true);
    expect(canDisplaySessionModel(makeSession({ sessionType: 'codex', model: 'gpt-5' }))).toBe(false);
    expect(canDisplaySessionModel(makeSession({ model: null }))).toBe(false);
  });

  it('exposes correct supportsPlanMode flags per agent', () => {
    expect(getAgentDefinition('claude')?.supportsPlanMode).toBe(true);
    expect(getAgentDefinition('codex')?.supportsPlanMode).toBe(false);
    expect(getAgentDefinition('gemini')?.supportsPlanMode).toBe(false);
  });

  it('exposes correct supportsTaskQueue flags per agent', () => {
    expect(getAgentDefinition('claude')?.supportsTaskQueue).toBe(true);
    expect(getAgentDefinition('codex')?.supportsTaskQueue).toBe(false);
    expect(getAgentDefinition('gemini')?.supportsTaskQueue).toBe(true);
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