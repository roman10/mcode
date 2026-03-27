import { describe, it, expect } from 'vitest';
import { detectAIAssisted } from '../../../src/main/commit-tracker';

describe('detectAIAssisted', () => {
  it('detects Claude and Anthropic co-authors', () => {
    expect(detectAIAssisted('Co-authored-by: Claude <noreply@anthropic.com>')).toBe(true);
    expect(detectAIAssisted('Co-authored-by: helper <bot@anthropic.com>')).toBe(true);
  });

  it('detects Codex and OpenAI co-authors', () => {
    expect(detectAIAssisted('Co-authored-by: Codex <noreply@openai.com>')).toBe(true);
    expect(detectAIAssisted('Co-authored-by: agent <bot@openai.com>')).toBe(true);
  });

  it('does not flag normal human co-authors', () => {
    expect(detectAIAssisted('Co-authored-by: Jane Doe <jane@example.com>')).toBe(false);
    expect(detectAIAssisted('')).toBe(false);
  });
});
