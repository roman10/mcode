import { describe, expect, it } from 'vitest';
import {
  canDisplaySessionModel,
  canSessionBeDefaultTaskTarget,
  canSessionBePlanResponseTarget,
  canSessionBeTaskTarget,
  canSessionQueueTasks,
  getSessionSlashCommandHelp,
  getSessionSlashCommandSupport,
  getSessionInstallHelp,
  hasLiveTaskQueue,
  supportsSessionSlashCommands,
} from '../../../src/shared/session-capabilities';
import { AGENT_SESSION_TYPES, getAgentDefinition, isAgentSessionType, shouldHideTerminalCursor } from '../../../src/shared/session-agents';
import type { SessionType } from '../../../src/shared/types';
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
    expect(canSessionQueueTasks(makeSession({ sessionType: 'copilot', hookMode: 'fallback' }))).toBe(false);
    expect(canSessionBeTaskTarget(makeSession({ status: 'ended' }))).toBe(false);
    expect(canSessionBeTaskTarget(makeSession({ status: 'detached' }))).toBe(false);
    expect(canSessionBeDefaultTaskTarget(makeSession({ status: 'ended' }))).toBe(false);
    expect(canSessionBeDefaultTaskTarget(makeSession({ status: 'detached' }))).toBe(false);
  });

  it('allows waiting and starting sessions as task targets (tasks queue until idle)', () => {
    expect(canSessionBeTaskTarget(makeSession({ status: 'waiting' }))).toBe(true);
    expect(canSessionBeTaskTarget(makeSession({ status: 'starting' }))).toBe(true);
    expect(canSessionBeDefaultTaskTarget(makeSession({ status: 'starting' }))).toBe(true);
    expect(canSessionBeDefaultTaskTarget(makeSession({ status: 'waiting' }))).toBe(true);
  });

  it('allows live Copilot sessions to queue tasks', () => {
    expect(hasLiveTaskQueue(makeSession({ sessionType: 'copilot', hookMode: 'live' }))).toBe(true);
    expect(canSessionQueueTasks(makeSession({ sessionType: 'copilot', hookMode: 'live' }))).toBe(true);
    expect(canSessionBeTaskTarget(makeSession({ sessionType: 'copilot', hookMode: 'live', status: 'idle' }))).toBe(true);
  });

  it('blocks fallback Copilot sessions from task queue', () => {
    expect(hasLiveTaskQueue(makeSession({ sessionType: 'copilot', hookMode: 'fallback' }))).toBe(false);
    expect(canSessionQueueTasks(makeSession({ sessionType: 'copilot', hookMode: 'fallback' }))).toBe(false);
  });

  it('hasLiveTaskQueue does not gate on session status', () => {
    // hasLiveTaskQueue checks agent support + hookMode only, not status —
    // this is critical so ended sessions can reach the resume path in TaskQueue.create()
    expect(hasLiveTaskQueue(makeSession({ sessionType: 'copilot', hookMode: 'live', status: 'ended' }))).toBe(true);
    expect(hasLiveTaskQueue(makeSession({ sessionType: 'claude', hookMode: 'live', status: 'ended' }))).toBe(true);
  });

  it('shows model pills only for agents that support model display', () => {
    expect(canDisplaySessionModel(makeSession({ model: 'claude-sonnet-4-5' }))).toBe(true);
    expect(canDisplaySessionModel(makeSession({ sessionType: 'copilot', model: 'gpt-4o' }))).toBe(true);
    expect(canDisplaySessionModel(makeSession({ sessionType: 'codex', model: 'gpt-5' }))).toBe(true);
    expect(canDisplaySessionModel(makeSession({ model: null }))).toBe(false);
    // agy has no model flag → never displays a model pill even if one is somehow set
    expect(canDisplaySessionModel(makeSession({ sessionType: 'agy', model: 'gpt-5' }))).toBe(false);
  });

  it('exposes correct supportsPlanMode flags per agent', () => {
    expect(getAgentDefinition('claude')?.supportsPlanMode).toBe(true);
    expect(getAgentDefinition('codex')?.supportsPlanMode).toBe(false);
    expect(getAgentDefinition('copilot')?.supportsPlanMode).toBe(false);
    expect(getAgentDefinition('agy')?.supportsPlanMode).toBe(false);
  });

  it('exposes correct supportsTaskQueue flags per agent', () => {
    expect(getAgentDefinition('claude')?.supportsTaskQueue).toBe(true);
    expect(getAgentDefinition('codex')?.supportsTaskQueue).toBe(true);
    expect(getAgentDefinition('copilot')?.supportsTaskQueue).toBe(true);
    expect(getAgentDefinition('agy')?.supportsTaskQueue).toBe(true);
  });

  it('exposes correct autoLabelFromFirstPrompt flags per agent', () => {
    // Claude self-titles via OSC terminal title, so it opts OUT of the
    // first-prompt hook label path; every other launchable agent opts in.
    expect(getAgentDefinition('claude')?.autoLabelFromFirstPrompt).toBe(false);
    expect(getAgentDefinition('codex')?.autoLabelFromFirstPrompt).toBe(true);
    expect(getAgentDefinition('copilot')?.autoLabelFromFirstPrompt).toBe(true);
    expect(getAgentDefinition('agy')?.autoLabelFromFirstPrompt).toBe(true);
  });

  it('opts only Claude out of first-prompt auto-labeling (capability invariant)', () => {
    for (const type of AGENT_SESSION_TYPES) {
      const optsOut = getAgentDefinition(type)?.autoLabelFromFirstPrompt === false;
      expect(optsOut, `${type} autoLabelFromFirstPrompt opt-out`).toBe(type === 'claude');
    }
  });

  it('registers agy as an agent session type with an Antigravity install URL', () => {
    expect(isAgentSessionType('agy')).toBe(true);
    expect(getAgentDefinition('agy')?.displayName).toBe('Antigravity CLI');
    expect(getSessionInstallHelp('agy')).toEqual({
      command: 'agy',
      displayName: 'Antigravity CLI',
      url: 'https://antigravity.google/docs/cli-using',
    });
    expect(supportsSessionSlashCommands('agy')).toBe(true);
  });

  // Phase 0 guard: the New Session and Handoff dialogs render their option lists by
  // mapping AGENT_SESSION_TYPES through getAgentDefinition(t)!.displayName. This asserts
  // every registered agent type resolves to a definition with a usable display name, so
  // those dropdowns can never drift from (or crash against) the registry.
  it('every AGENT_SESSION_TYPES entry resolves to a definition with a display name', () => {
    for (const type of AGENT_SESSION_TYPES) {
      const def = getAgentDefinition(type);
      expect(def, `missing AgentDefinition for "${type}"`).not.toBeNull();
      expect(def!.displayName.length).toBeGreaterThan(0);
    }
  });

  // Gemini was retired as a launchable agent but remains a recognized SessionType so
  // historical rows (and the kept token/quota/account analytics) still render. This locks
  // that split: 'gemini' must NOT be launchable/registered, yet must stay a known type.
  it('treats gemini as a retired, non-launchable session type', () => {
    expect(isAgentSessionType('gemini')).toBe(false);
    expect(getAgentDefinition('gemini')).toBeNull();
    expect(AGENT_SESSION_TYPES).not.toContain('gemini');
    expect(supportsSessionSlashCommands('gemini')).toBe(false);
    expect(getSessionInstallHelp('gemini')).toBeNull();
    // ...but 'gemini' is still a valid SessionType for historical rows.
    const historical: SessionType = 'gemini';
    expect(historical).toBe('gemini');
  });

  it('returns install help only for agents with an install URL', () => {
    expect(getSessionInstallHelp('claude')).toEqual({
      command: 'claude',
      displayName: 'Claude Code',
      url: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    });
    expect(getSessionInstallHelp('copilot')).toEqual({
      command: 'copilot',
      displayName: 'Copilot CLI',
      url: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started',
    });
    expect(getSessionInstallHelp('codex')).toBeNull();
  });

  it('exposes slash command support for all agent CLIs', () => {
    expect(supportsSessionSlashCommands('claude')).toBe(true);
    expect(supportsSessionSlashCommands('codex')).toBe(true);
    expect(supportsSessionSlashCommands('copilot')).toBe(true);
    expect(supportsSessionSlashCommands('terminal')).toBe(false);
  });

  it('returns slash command metadata for discoverability helpers', () => {
    expect(getSessionSlashCommandHelp('claude')).toEqual({
      command: '/help',
      displayName: 'Claude Code',
      supportsCustomCommands: true,
    });
    expect(getSessionSlashCommandHelp('copilot')).toEqual({
      command: '/help',
      displayName: 'Copilot CLI',
      supportsCustomCommands: false,
    });
    expect(getSessionSlashCommandHelp('terminal')).toBeNull();
  });

  it('exposes agent-specific slash command definitions', () => {
    expect(getSessionSlashCommandSupport('claude')?.builtins.get('compact')).toBeTruthy();
    expect(getSessionSlashCommandSupport('codex')?.builtins.get('plan')).toBeTruthy();
    expect(getSessionSlashCommandSupport('copilot')?.builtins.get('usage')).toBeTruthy();
    expect(getSessionSlashCommandSupport('terminal')).toBeNull();
  });

  it('allows plan response targets for Claude in active/idle/waiting states', () => {
    expect(canSessionBePlanResponseTarget(makeSession({ status: 'active' }))).toBe(true);
    expect(canSessionBePlanResponseTarget(makeSession({ status: 'idle' }))).toBe(true);
    expect(canSessionBePlanResponseTarget(makeSession({ status: 'waiting' }))).toBe(true);
  });

  it('blocks plan response targets for ended/starting/detached Claude sessions', () => {
    expect(canSessionBePlanResponseTarget(makeSession({ status: 'ended' }))).toBe(false);
    expect(canSessionBePlanResponseTarget(makeSession({ status: 'starting' }))).toBe(false);
    expect(canSessionBePlanResponseTarget(makeSession({ status: 'detached' }))).toBe(false);
  });

  it('blocks plan response targets for non-plan-mode agents', () => {
    expect(canSessionBePlanResponseTarget(makeSession({ sessionType: 'copilot', hookMode: 'live', status: 'idle' }))).toBe(false);
    expect(canSessionBePlanResponseTarget(makeSession({ sessionType: 'codex', hookMode: 'live', status: 'idle' }))).toBe(false);
  });

  it('blocks plan response targets for fallback-mode Claude sessions', () => {
    expect(canSessionBePlanResponseTarget(makeSession({ hookMode: 'fallback', status: 'idle' }))).toBe(false);
  });

  it('hides terminal cursor only for agents that manage DECTCEM visibility', () => {
    expect(shouldHideTerminalCursor('claude')).toBe(true);
    expect(shouldHideTerminalCursor('codex')).toBe(true);
    expect(shouldHideTerminalCursor('copilot')).toBe(false);
    expect(shouldHideTerminalCursor('agy')).toBe(true);
    expect(shouldHideTerminalCursor('terminal')).toBe(false);
    expect(shouldHideTerminalCursor(undefined)).toBe(false);
  });
});
