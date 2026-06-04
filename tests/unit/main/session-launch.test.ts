import { describe, expect, it } from 'vitest';
import {
  buildSessionLabel,
  getDefaultSessionCommand,
  prefixSessionLabel,
  truncatePromptToLabel,
} from '../../../src/main/session/session-launch';

describe('session-launch helpers', () => {
  it('prefixes agent labels while leaving terminal labels unchanged', () => {
    expect(prefixSessionLabel('My Session', 'claude')).toBe('\u2733 My Session');
    expect(prefixSessionLabel('My Session', 'codex')).toBe('\u2742 My Session');
    expect(prefixSessionLabel('My Session', 'agy')).toBe('\u2756 My Session');
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

  it('truncates prompt to label at word boundary', () => {
    expect(truncatePromptToLabel('fix the auth bug', 50)).toBe('fix the auth bug');
    expect(truncatePromptToLabel('short', 50)).toBe('short');
    expect(truncatePromptToLabel('', 50)).toBe('');
    expect(truncatePromptToLabel('  \n  ', 50)).toBe('');
  });

  it('truncates long prompts with ellipsis', () => {
    const long = 'refactor the authentication middleware to use JWT tokens instead of session cookies';
    const result = truncatePromptToLabel(long, 50);
    expect(result.length).toBeLessThanOrEqual(53); // 50 + '...'
    expect(result).toMatch(/\.\.\.$/);
  });

  it('uses only first line of multi-line prompt', () => {
    expect(truncatePromptToLabel('fix the bug\nmore details here', 50)).toBe('fix the bug');
  });

  it('handles prompt at exact truncation boundary', () => {
    const exact = 'a'.repeat(50);
    expect(truncatePromptToLabel(exact, 50)).toBe(exact);
    expect(truncatePromptToLabel(exact, 50)).not.toMatch(/\.\.\.$/);
    // One char over triggers truncation
    expect(truncatePromptToLabel('a'.repeat(51), 50)).toMatch(/\.\.\.$/);
  });

  it('treats tabs and mixed whitespace as empty', () => {
    expect(truncatePromptToLabel('\t\t\t', 50)).toBe('');
    expect(truncatePromptToLabel('  \t  \n  \t  ', 50)).toBe('');
  });

  it('resolves default commands by session type', () => {
    expect(getDefaultSessionCommand('claude', '/bin/zsh')).toBe('claude');
    expect(getDefaultSessionCommand('codex', '/bin/zsh')).toBe('codex');
    expect(getDefaultSessionCommand('agy', '/bin/zsh')).toBe('agy');
    expect(getDefaultSessionCommand('terminal', '/bin/zsh')).toBe('/bin/zsh');
  });

});
