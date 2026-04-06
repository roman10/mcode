import { describe, it, expect } from 'vitest';
import { stripAnsi } from '../../../src/shared/strip-ansi';

describe('stripAnsi', () => {
  it('strips CSI sequences (color codes)', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[0m')).toBe('green');
    expect(stripAnsi('\x1b[1;31mbold red\x1b[0m')).toBe('bold red');
  });

  it('strips CSI sequences with ? prefix', () => {
    // Cursor visibility: \x1b[?25h (show) \x1b[?25l (hide)
    expect(stripAnsi('\x1b[?25hvisible\x1b[?25l')).toBe('visible');
  });

  it('strips OSC sequences (title, hyperlinks)', () => {
    // OSC terminated by BEL (\x07)
    expect(stripAnsi('\x1b]0;window title\x07text')).toBe('text');
    // OSC terminated by ST (\x1b\\)
    expect(stripAnsi('\x1b]0;window title\x1b\\text')).toBe('text');
  });

  it('strips carriage returns', () => {
    expect(stripAnsi('line1\rline2')).toBe('line1line2');
  });

  it('strips BEL character', () => {
    expect(stripAnsi('beep\x07')).toBe('beep');
  });

  it('strips SI/SO characters', () => {
    expect(stripAnsi('\x0ftext\x0e')).toBe('text');
  });

  it('passes through plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
    expect(stripAnsi('')).toBe('');
    expect(stripAnsi('no escapes here')).toBe('no escapes here');
  });

  it('preserves newlines', () => {
    expect(stripAnsi('line1\nline2\n')).toBe('line1\nline2\n');
  });

  it('handles mixed ANSI and plain text', () => {
    const input = '\x1b[1mBold\x1b[0m normal \x1b[4munderline\x1b[0m';
    expect(stripAnsi(input)).toBe('Bold normal underline');
  });

  it('preserves Unicode characters (including prompt ❯)', () => {
    expect(stripAnsi('❯ hello')).toBe('❯ hello');
    expect(stripAnsi('\x1b[32m❯\x1b[0m prompt')).toBe('❯ prompt');
  });

  it('replaces cursor-right (CSI 1C) with a single space', () => {
    expect(stripAnsi('hello\x1b[1Cworld')).toBe('hello world');
  });

  it('replaces cursor-right with explicit count (CSI 3C) with N spaces', () => {
    expect(stripAnsi('a\x1b[3Cb')).toBe('a   b');
  });

  it('replaces cursor-right with no count (CSI C) with 1 space (default)', () => {
    expect(stripAnsi('a\x1b[Cb')).toBe('a b');
  });

  it('converts cursor-right to spaces in a Claude Code menu', () => {
    // Real-world: Claude Code renders menu items with [1C between words
    const raw = '\x1b[38;2;177;185;249m❯\x1b[1C\x1b[38;2;153;153;153m1.\x1b[1C\x1b[38;2;177;185;249mYes,\x1b[1Cand\x1b[1Cbypass\x1b[1Cpermissions\x1b[39m';
    expect(stripAnsi(raw)).toBe('❯ 1. Yes, and bypass permissions');
  });
});
