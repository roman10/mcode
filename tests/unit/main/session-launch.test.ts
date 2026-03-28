import { describe, expect, it } from 'vitest';
import {
  buildCreateSessionArgs,
  buildSessionLabel,
  getDefaultSessionCommand,
  prefixSessionLabel,
} from '../../../src/main/session/session-launch';

describe('session-launch helpers', () => {
  it('prefixes agent labels while leaving terminal labels unchanged', () => {
    expect(prefixSessionLabel('My Session', 'claude')).toBe('\u2733 My Session');
    expect(prefixSessionLabel('My Session', 'codex')).toBe('\u2742 My Session');
    expect(prefixSessionLabel('My Session', 'gemini')).toBe('\u2726 My Session');
    expect(prefixSessionLabel('shell', 'terminal')).toBe('shell');
  });

  it('builds user and auto labels consistently', () => {
    expect(buildSessionLabel({
      sessionType: 'claude',
      userLabel: 'Work on tests',
      nextDisambiguatedLabel: () => 'repo',
    })).toEqual({
      label: '\u2733 Work on tests',
      labelSource: 'user',
    });

    expect(buildSessionLabel({
      sessionType: 'codex',
      initialPrompt: 'Investigate flaky test failure',
      nextDisambiguatedLabel: () => 'repo',
    })).toEqual({
      label: '\u2742 Investigate flaky test failure',
      labelSource: 'auto',
    });
  });

  it('resolves default commands by session type', () => {
    expect(getDefaultSessionCommand('claude', '/bin/zsh')).toBe('claude');
    expect(getDefaultSessionCommand('codex', '/bin/zsh')).toBe('codex');
    expect(getDefaultSessionCommand('gemini', '/bin/zsh')).toBe('gemini');
    expect(getDefaultSessionCommand('terminal', '/bin/zsh')).toBe('/bin/zsh');
  });

  it('builds create args for codex, gemini, and claude sessions', () => {
    expect(buildCreateSessionArgs({
      session: { cwd: '/repo', sessionType: 'codex', initialPrompt: 'inspect', args: ['ignored'] },
      sessionType: 'codex',
      isTerminal: false,
      codexBridgeReady: true,
    })).toEqual(['--enable', 'codex_hooks', 'inspect']);

    expect(buildCreateSessionArgs({
      session: { cwd: '/repo', sessionType: 'gemini', model: 'gemini-2.5-pro', initialPrompt: 'inspect' },
      sessionType: 'gemini',
      isTerminal: false,
      codexBridgeReady: false,
    })).toEqual(['--model', 'gemini-2.5-pro', 'inspect']);

    expect(buildCreateSessionArgs({
      session: {
        cwd: '/repo',
        sessionType: 'claude',
        permissionMode: 'auto',
        effort: 'high',
        enableAutoMode: true,
        allowBypassPermissions: true,
        initialPrompt: 'ship it',
      },
      sessionType: 'claude',
      isTerminal: false,
      codexBridgeReady: false,
    })).toEqual([
      '--permission-mode', 'auto',
      '--effort', 'high',
      '--enable-auto-mode',
      '--allow-dangerously-skip-permissions',
      'ship it',
    ]);
  });
});
