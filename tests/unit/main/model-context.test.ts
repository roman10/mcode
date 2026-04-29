import { describe, it, expect } from 'vitest';
import { getContextWindow } from '../../../src/main/trackers/model-context';

describe('getContextWindow', () => {
  describe('Claude provider', () => {
    it('returns 200K for known Claude 4.x models', () => {
      expect(getContextWindow('claude-opus-4-7', 'claude')).toBe(200_000);
      expect(getContextWindow('claude-opus-4-6', 'claude')).toBe(200_000);
      expect(getContextWindow('claude-sonnet-4-6', 'claude')).toBe(200_000);
      expect(getContextWindow('claude-haiku-4-5', 'claude')).toBe(200_000);
    });

    it('returns 200K when raw id has a date suffix', () => {
      expect(getContextWindow('claude-sonnet-4-5-20251022', 'claude')).toBe(200_000);
    });

    it('detects [1m] suffix and returns 1M', () => {
      expect(getContextWindow('claude-opus-4-7[1m]', 'claude')).toBe(1_000_000);
      expect(getContextWindow('claude-sonnet-4-6[1m]', 'claude')).toBe(1_000_000);
    });

    it('returns 1M for [1m] even when the underlying model is otherwise known', () => {
      expect(getContextWindow('claude-haiku-4-5[1m]', 'claude')).toBe(1_000_000);
    });

    it('returns null for unknown Claude models', () => {
      expect(getContextWindow('claude-future-99', 'claude')).toBeNull();
      expect(getContextWindow('claude-opus-99-9', 'claude')).toBeNull();
    });
  });

  describe('Other providers', () => {
    it('returns null for codex (v1 scope)', () => {
      expect(getContextWindow('gpt-5.4', 'codex')).toBeNull();
    });

    it('returns null for gemini (v1 scope)', () => {
      expect(getContextWindow('models/gemini-2.5-pro', 'gemini')).toBeNull();
    });

    it('returns null for copilot (no per-message data)', () => {
      expect(getContextWindow('claude-sonnet-4-6', 'copilot')).toBeNull();
    });
  });
});
