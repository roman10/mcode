import { describe, it, expect } from 'vitest';
import { normalizeClaudeLabel, splitLabelIcon } from '../../../../src/renderer/utils/label-utils';

describe('normalizeClaudeLabel', () => {
  it('replaces Braille spinner characters with canonical icon', () => {
    // Braille range U+2800-U+28FF
    expect(normalizeClaudeLabel('\u2801 Working on task')).toBe('\u2733 Working on task');
    expect(normalizeClaudeLabel('\u28FF Busy')).toBe('\u2733 Busy');
  });

  it('normalizes the canonical icon itself (idempotent)', () => {
    expect(normalizeClaudeLabel('\u2733 Already normalized')).toBe('\u2733 Already normalized');
  });

  it('leaves labels without Braille/icon prefix unchanged', () => {
    expect(normalizeClaudeLabel('My Custom Session')).toBe('My Custom Session');
    expect(normalizeClaudeLabel('')).toBe('');
  });

  it('handles Braille character with extra spacing', () => {
    expect(normalizeClaudeLabel('\u2801   spaced out')).toBe('\u2733 spaced out');
  });
});

describe('splitLabelIcon', () => {
  it('splits canonical icon from text', () => {
    const [icon, text] = splitLabelIcon('\u2733 My Session');
    expect(icon).toBe('\u2733');
    expect(text).toBe('My Session');
  });

  it('splits Braille character (legacy) and normalizes to canonical icon', () => {
    const [icon, text] = splitLabelIcon('\u2801 Legacy Label');
    expect(icon).toBe('\u2733');
    expect(text).toBe('Legacy Label');
  });

  it('returns empty icon for labels without prefix', () => {
    const [icon, text] = splitLabelIcon('Plain Label');
    expect(icon).toBe('');
    expect(text).toBe('Plain Label');
  });

  it('returns empty icon for empty string', () => {
    const [icon, text] = splitLabelIcon('');
    expect(icon).toBe('');
    expect(text).toBe('');
  });

  it('handles icon with no trailing text', () => {
    const [icon, text] = splitLabelIcon('\u2733 ');
    expect(icon).toBe('\u2733');
    expect(text).toBe('');
  });
});
