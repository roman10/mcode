import { describe, it, expect } from 'vitest';
import { parseShellHistory } from '../../../src/main/services/shell-history-reader';

describe('parseShellHistory', () => {
  it('returns [] for empty input', () => {
    expect(parseShellHistory('')).toEqual([]);
  });

  it('parses zsh extended format', () => {
    const input = [
      ': 1700000000:0;ls -la',
      ': 1700000100:5;git status',
      ': 1700000200:0;echo hello',
      '',
    ].join('\n');

    const entries = parseShellHistory(input);
    expect(entries).toEqual([
      { command: 'ls -la', ts: 1700000000 },
      { command: 'git status', ts: 1700000100 },
      { command: 'echo hello', ts: 1700000200 },
    ]);
  });

  it('parses bash plain format', () => {
    const input = ['ls\n', 'git status\n', 'echo hello'].join('');
    const entries = parseShellHistory(input);
    expect(entries.map((e) => e.command)).toEqual(['ls', 'git status', 'echo hello']);
    expect(entries.every((e) => e.ts === null)).toBe(true);
  });

  it('parses bash HISTTIMEFORMAT timestamp lines', () => {
    const input = ['#1700000000', 'ls -la', '#1700000100', 'git status', ''].join('\n');
    const entries = parseShellHistory(input);
    expect(entries).toEqual([
      { command: 'ls -la', ts: 1700000000 },
      { command: 'git status', ts: 1700000100 },
    ]);
  });

  it('stitches multi-line zsh entries joined by trailing backslash', () => {
    const input = [
      ': 1700000000:0;echo one \\',
      'continued',
      ': 1700000100:0;echo two',
      '',
    ].join('\n');
    const entries = parseShellHistory(input);
    expect(entries[0]?.command).toBe('echo one \ncontinued');
    expect(entries[1]?.command).toBe('echo two');
  });

  it('tolerates malformed lines by falling back to plain', () => {
    const input = [
      'valid-cmd',
      ': 1700000000:0;good-cmd',
      ': malformed',
      'another-cmd',
      '',
    ].join('\n');
    const entries = parseShellHistory(input);
    expect(entries.map((e) => e.command)).toEqual([
      'valid-cmd',
      'good-cmd',
      ': malformed',
      'another-cmd',
    ]);
  });

  it('skips empty commands', () => {
    const input = [': 1700000000:0;', 'valid', ''].join('\n');
    const entries = parseShellHistory(input);
    expect(entries.map((e) => e.command)).toEqual(['valid']);
  });
});
