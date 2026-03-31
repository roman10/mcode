import { describe, expect, it } from 'vitest';
import {
  buildUnsupportedSlashCommandWarning,
  parseSlashCommandName,
  stripTerminalInputControlSequences,
} from '../../../../src/renderer/utils/slash-command-validation';

describe('slash-command-validation', () => {
  it('parses a slash command without arguments', () => {
    expect(parseSlashCommandName('/help')).toBe('help');
  });

  it('parses a slash command with arguments', () => {
    expect(parseSlashCommandName('/model gpt-5.4')).toBe('model');
  });

  it('trims leading whitespace before parsing', () => {
    expect(parseSlashCommandName('   /review diff')).toBe('review');
  });

  it('returns null for non-command input', () => {
    expect(parseSlashCommandName('explain the codebase')).toBeNull();
  });

  it('does not warn for known commands', () => {
    expect(
      buildUnsupportedSlashCommandWarning('/help', ['help', 'model'], 'Copilot CLI'),
    ).toBeNull();
  });

  it('warns for unknown commands while allowing passthrough', () => {
    expect(
      buildUnsupportedSlashCommandWarning('/mystery arg', ['help', 'model'], 'Gemini CLI'),
    ).toBe(
      "/mystery is not in mcode's known Gemini CLI slash commands. It may still work if your CLI, extensions, or plugins add it.",
    );
  });

  it('strips terminal escape sequences before validation', () => {
    expect(stripTerminalInputControlSequences('/help\x1b[A\x1b[B')).toBe('/help');
  });
});
