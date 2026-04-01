import { describe, it, expect } from 'vitest';
import { parseInput } from '../../../../src/renderer/components/CommandPalette/TodoItems';

describe('parseInput', () => {
  it('returns plain text with no modifiers', () => {
    expect(parseInput('Fix the login bug')).toEqual({ text: 'Fix the login bug' });
  });

  it('parses trailing #priority', () => {
    expect(parseInput('Fix bug #high')).toEqual({ text: 'Fix bug', priority: 'high' });
    expect(parseInput('Fix bug #medium')).toEqual({ text: 'Fix bug', priority: 'medium' });
    expect(parseInput('Fix bug #low')).toEqual({ text: 'Fix bug', priority: 'low' });
  });

  it('parses trailing @repo', () => {
    expect(parseInput('Fix bug @mcode')).toEqual({ text: 'Fix bug', repoToken: 'mcode' });
  });

  it('parses #priority then @repo (priority first)', () => {
    expect(parseInput('Fix bug #high @mcode')).toEqual({
      text: 'Fix bug',
      priority: 'high',
      repoToken: 'mcode',
    });
  });

  it('parses @repo then #priority (repo first)', () => {
    expect(parseInput('Fix bug @mcode #high')).toEqual({
      text: 'Fix bug',
      priority: 'high',
      repoToken: 'mcode',
    });
  });

  it('leaves text with inline @ untouched (not a suffix)', () => {
    expect(parseInput('mention @alice in comments')).toEqual({
      text: 'mention @alice in comments',
    });
  });

  it('strips modifiers when there is text before them', () => {
    // Modifiers require a space prefix, so they must follow actual text
    const result = parseInput('x #high @mcode');
    expect(result.text).toBe('x');
    expect(result.priority).toBe('high');
    expect(result.repoToken).toBe('mcode');
  });

  it('trims surrounding whitespace', () => {
    expect(parseInput('  Fix bug  #high  ')).toEqual({ text: 'Fix bug', priority: 'high' });
  });
});
