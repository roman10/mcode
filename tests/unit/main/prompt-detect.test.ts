import { describe, it, expect } from 'vitest';
import { isAtClaudePrompt, isAtUserChoice, parseUserChoices } from '../../../src/main/prompt-detect';

describe('isAtClaudePrompt', () => {
  it('detects a clean prompt', () => {
    expect(isAtClaudePrompt('some output\n❯ ')).toBe(true);
  });

  it('detects prompt with short status bar tail', () => {
    // Status bar content after ❯ is typically < 300 chars
    const tail = '❯ ' + 'x'.repeat(100);
    expect(isAtClaudePrompt(tail)).toBe(true);
  });

  it('rejects when no prompt character present', () => {
    expect(isAtClaudePrompt('just some terminal output')).toBe(false);
    expect(isAtClaudePrompt('')).toBe(false);
  });

  it('accepts moderate status bar accumulation after prompt', () => {
    // Status bar updates accumulate ~80-100 stripped chars each;
    // 500 chars is within the 800-char threshold
    const tail = '❯ ' + 'x'.repeat(500);
    expect(isAtClaudePrompt(tail)).toBe(true);
  });

  it('rejects when substantial content follows the prompt', () => {
    // More than 800 chars after ❯ means Claude is still outputting
    const tail = '❯ ' + 'x'.repeat(900);
    expect(isAtClaudePrompt(tail)).toBe(false);
  });

  it('accepts a few newlines in status bar tail', () => {
    const tail = '❯ \nstatus1\nstatus2\nstatus3\n';
    expect(isAtClaudePrompt(tail)).toBe(true);
  });

  it('rejects when too many newlines follow the prompt', () => {
    // More than 5 newlines = multi-line output, not status bar
    const tail = '❯ \nline1\nline2\nline3\nline4\nline5\nline6\n';
    expect(isAtClaudePrompt(tail)).toBe(false);
  });

  it('handles ANSI sequences around the prompt', () => {
    const tail = '\x1b[32m❯\x1b[0m ';
    expect(isAtClaudePrompt(tail)).toBe(true);
  });

  it('uses the last prompt character when multiple exist', () => {
    // Earlier ❯ in output, last one is the actual prompt
    const tail = 'previous ❯ output\n❯ ';
    expect(isAtClaudePrompt(tail)).toBe(true);
  });
});

describe('isAtUserChoice', () => {
  it('detects a numbered choice menu', () => {
    const menu = `
❯ 1. Yes, and bypass permissions
  2. Yes, manually approve edits
  3. Type here to tell Claude what to change
`;
    expect(isAtUserChoice(menu)).toBe(true);
  });

  it('rejects a normal prompt without choices', () => {
    expect(isAtUserChoice('❯ ')).toBe(false);
  });

  it('rejects when no prompt character present', () => {
    expect(isAtUserChoice('just text')).toBe(false);
    expect(isAtUserChoice('')).toBe(false);
  });

  it('only checks the last 500 characters', () => {
    // Menu far from end should still be detected if within 500 chars
    const menu = '❯ 1. Option one\n  2. Option two\n';
    const padding = 'x'.repeat(400);
    expect(isAtUserChoice(padding + menu)).toBe(true);
  });
});

describe('parseUserChoices', () => {
  it('parses numbered options from a menu', () => {
    const menu = `
❯ 1. Yes, and bypass permissions
  2. Yes, manually approve edits
  3. Type here to tell Claude what to change
`;
    const choices = parseUserChoices(menu);
    expect(choices).toEqual([
      { index: 1, text: 'Yes, and bypass permissions' },
      { index: 2, text: 'Yes, manually approve edits' },
      { index: 3, text: 'Type here to tell Claude what to change' },
    ]);
  });

  it('returns empty array when no menu found', () => {
    expect(parseUserChoices('❯ ')).toEqual([]);
    expect(parseUserChoices('no menu here')).toEqual([]);
    expect(parseUserChoices('')).toEqual([]);
  });

  it('handles two-option menus', () => {
    const menu = '❯ 1. Yes\n  2. No\n';
    const choices = parseUserChoices(menu);
    expect(choices).toHaveLength(2);
    expect(choices[0]).toEqual({ index: 1, text: 'Yes' });
    expect(choices[1]).toEqual({ index: 2, text: 'No' });
  });

  it('trims whitespace from option text', () => {
    const menu = '❯ 1.   padded text   \n';
    const choices = parseUserChoices(menu);
    expect(choices[0].text).toBe('padded text');
  });

  it('handles ANSI codes in the buffer', () => {
    const menu = '\x1b[32m❯\x1b[0m 1. Option A\n  2. Option B\n';
    const choices = parseUserChoices(menu);
    expect(choices).toHaveLength(2);
  });
});
