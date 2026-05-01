import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _resetOneMillionContextCache,
  getContextWindow,
  setClaudeConfigPathsProvider,
} from '../../../src/main/trackers/model-context';

describe('getContextWindow', () => {
  beforeEach(() => {
    _resetOneMillionContextCache();
  });

  describe('Claude provider', () => {
    it('returns 200K for known Claude 4.x models without 1M tier', () => {
      expect(getContextWindow('claude-opus-4-6', 'claude')).toBe(200_000);
      expect(getContextWindow('claude-sonnet-4-6', 'claude')).toBe(200_000);
      expect(getContextWindow('claude-haiku-4-5', 'claude')).toBe(200_000);
    });

    it('returns 1M for opus-4.7 by default (native 1M for plans that ship it)', () => {
      expect(getContextWindow('claude-opus-4-7', 'claude')).toBe(1_000_000);
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

  describe('per-account 1M-tier detection from .claude.json', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'mcode-mc-'));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeClaudeJson(filename: string, projects: Record<string, unknown>): string {
      const path = join(tmpDir, filename);
      writeFileSync(path, JSON.stringify({ projects }));
      return path;
    }

    it('promotes a bare model id to 1M when the user has used [1m] for it', () => {
      const path = writeClaudeJson('a.json', {
        '/proj/x': { lastModelUsage: { 'claude-sonnet-4-6[1m]': { inputTokens: 1 } } },
      });
      setClaudeConfigPathsProvider(() => [path]);

      expect(getContextWindow('claude-sonnet-4-6', 'claude')).toBe(1_000_000);
    });

    it('does not promote when no [1m] entry exists for that model', () => {
      const path = writeClaudeJson('a.json', {
        '/proj/x': { lastModelUsage: { 'claude-sonnet-4-6': { inputTokens: 1 } } },
      });
      setClaudeConfigPathsProvider(() => [path]);

      expect(getContextWindow('claude-sonnet-4-6', 'claude')).toBe(200_000);
    });

    it('unions [1m] models across multiple account .claude.json files', () => {
      const a = writeClaudeJson('a.json', {
        '/proj/x': { lastModelUsage: { 'claude-haiku-4-5[1m]': { inputTokens: 1 } } },
      });
      const b = writeClaudeJson('b.json', {
        '/proj/y': { lastModelUsage: { 'claude-sonnet-4-6[1m]': { inputTokens: 1 } } },
      });
      setClaudeConfigPathsProvider(() => [a, b]);

      expect(getContextWindow('claude-haiku-4-5', 'claude')).toBe(1_000_000);
      expect(getContextWindow('claude-sonnet-4-6', 'claude')).toBe(1_000_000);
    });

    it('skips missing files and malformed JSON without throwing', () => {
      const path = join(tmpDir, 'broken.json');
      writeFileSync(path, '{not json');
      setClaudeConfigPathsProvider(() => [path, join(tmpDir, 'does-not-exist.json')]);

      expect(getContextWindow('claude-sonnet-4-6', 'claude')).toBe(200_000);
    });

    it('does not affect unknown models — still returns null', () => {
      const path = writeClaudeJson('a.json', {
        '/proj/x': { lastModelUsage: { 'claude-sonnet-4-6[1m]': { inputTokens: 1 } } },
      });
      setClaudeConfigPathsProvider(() => [path]);

      expect(getContextWindow('claude-future-99', 'claude')).toBeNull();
    });
  });
});
