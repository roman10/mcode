import { describe, it, expect } from 'vitest';
import { normalizeAgentLabel, splitLabelIcon } from '../../../../src/renderer/utils/label-utils';

describe('normalizeAgentLabel', () => {
  it('replaces Braille spinner characters with canonical icon for Claude', () => {
    expect(normalizeAgentLabel('\u2801 Working on task', 'claude')).toBe('\u2733 Working on task');
    expect(normalizeAgentLabel('\u28FF Busy', 'claude')).toBe('\u2733 Busy');
  });

  it('normalizes the canonical Claude icon itself (idempotent)', () => {
    expect(normalizeAgentLabel('\u2733 Already normalized', 'claude')).toBe('\u2733 Already normalized');
  });

  it('leaves labels without Braille/icon prefix unchanged for Claude', () => {
    expect(normalizeAgentLabel('My Custom Session', 'claude')).toBe('My Custom Session');
  });

  it('handles Braille character with extra spacing for Claude', () => {
    expect(normalizeAgentLabel('\u2801   spaced out', 'claude')).toBe('\u2733 spaced out');
  });

  it('prepends Codex icon for codex sessions', () => {
    expect(normalizeAgentLabel('My Codex Task', 'codex')).toBe('\u2742 My Codex Task');
  });

  it('preserves Codex icon if already present', () => {
    expect(normalizeAgentLabel('\u2742 Already prefixed', 'codex')).toBe('\u2742 Already prefixed');
  });

  it('prepends Gemini icon for Gemini sessions', () => {
    expect(normalizeAgentLabel('My Gemini Task', 'gemini')).toBe('\u2726 My Gemini Task');
  });

  it('returns title unchanged for terminal sessions', () => {
    expect(normalizeAgentLabel('zsh', 'terminal')).toBe('zsh');
  });
});

describe('splitLabelIcon', () => {
  it('splits canonical Claude icon from text', () => {
    const [icon, text] = splitLabelIcon('\u2733 My Session');
    expect(icon).toBe('\u2733');
    expect(text).toBe('My Session');
  });

  it('splits Braille character (legacy) and normalizes to canonical Claude icon', () => {
    const [icon, text] = splitLabelIcon('\u2801 Legacy Label');
    expect(icon).toBe('\u2733');
    expect(text).toBe('Legacy Label');
  });

  it('splits Codex icon from text', () => {
    const [icon, text] = splitLabelIcon('\u2742 My Codex Session');
    expect(icon).toBe('\u2742');
    expect(text).toBe('My Codex Session');
  });

  it('splits Codex icon with no trailing space', () => {
    const [icon, text] = splitLabelIcon('\u2742NoSpace');
    expect(icon).toBe('\u2742');
    expect(text).toBe('NoSpace');
  });

  it('splits Gemini icon from text', () => {
    const [icon, text] = splitLabelIcon('\u2726 My Gemini Session');
    expect(icon).toBe('\u2726');
    expect(text).toBe('My Gemini Session');
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

  it('handles Claude icon with no trailing text', () => {
    const [icon, text] = splitLabelIcon('\u2733 ');
    expect(icon).toBe('\u2733');
    expect(text).toBe('');
  });
});
