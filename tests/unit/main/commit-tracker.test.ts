import { describe, it, expect } from 'vitest';
import {
  detectAIAssisted,
  detectAIProvider,
  matchSessionForCommit,
} from '../../../src/main/trackers/commit-tracker';
import { extractCommandString } from '../../../src/main/hooks/hook-utils';

describe('detectAIProvider', () => {
  it('detects Claude from Claude co-author', () => {
    expect(detectAIProvider('Co-authored-by: Claude <noreply@anthropic.com>')).toBe('claude');
  });

  it('detects Claude from Anthropic co-author', () => {
    expect(detectAIProvider('Co-authored-by: helper <bot@anthropic.com>')).toBe('claude');
  });

  it('detects Codex from Codex co-author', () => {
    expect(detectAIProvider('Co-authored-by: Codex <noreply@openai.com>')).toBe('codex');
  });

  it('detects Codex from OpenAI co-author', () => {
    expect(detectAIProvider('Co-authored-by: agent <bot@openai.com>')).toBe('codex');
  });

  it('detects Copilot', () => {
    expect(detectAIProvider('GitHub Copilot <noreply@github.com>')).toBe('copilot');
  });

  it('detects Gemini', () => {
    expect(detectAIProvider('Co-authored-by: Gemini <noreply@google.com>')).toBe('gemini');
  });

  it('does not match generic Google co-author', () => {
    expect(detectAIProvider('Co-authored-by: John <john@google.com>')).toBeNull();
  });

  it('returns null for normal human co-authors', () => {
    expect(detectAIProvider('Co-authored-by: Jane Doe <jane@example.com>')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectAIProvider('')).toBeNull();
  });
});

describe('detectAIAssisted', () => {
  it('detects Claude and Anthropic co-authors', () => {
    expect(detectAIAssisted('Co-authored-by: Claude <noreply@anthropic.com>')).toBe(true);
    expect(detectAIAssisted('Co-authored-by: helper <bot@anthropic.com>')).toBe(true);
  });

  it('detects Codex and OpenAI co-authors', () => {
    expect(detectAIAssisted('Co-authored-by: Codex <noreply@openai.com>')).toBe(true);
    expect(detectAIAssisted('Co-authored-by: agent <bot@openai.com>')).toBe(true);
  });

  it('detects Copilot co-authors', () => {
    expect(detectAIAssisted('GitHub Copilot <noreply@github.com>')).toBe(true);
    expect(detectAIAssisted('copilot-bot')).toBe(true);
  });

  it('detects Gemini co-authors', () => {
    expect(detectAIAssisted('Co-authored-by: Gemini <noreply@google.com>')).toBe(true);
  });

  it('does not flag normal human co-authors', () => {
    expect(detectAIAssisted('Co-authored-by: Jane Doe <jane@example.com>')).toBe(false);
    expect(detectAIAssisted('')).toBe(false);
  });
});

describe('matchSessionForCommit', () => {
  const REPO = '/Users/me/proj';

  it('returns null on empty candidate set', () => {
    expect(matchSessionForCommit([], REPO, '2026-03-18T10:00:00Z')).toBeNull();
  });

  it('matches a session whose cwd equals the repo root', () => {
    const candidates = [
      { session_type: 'claude', cwd: REPO, started_at: '2026-03-18T09:00:00Z', ended_at: null },
    ];
    expect(matchSessionForCommit(candidates, REPO, '2026-03-18T10:00:00Z')).toBe('claude');
  });

  it('matches a session whose cwd is a subdir of the repo', () => {
    const candidates = [
      { session_type: 'codex', cwd: `${REPO}/src`, started_at: '2026-03-18T09:00:00Z', ended_at: null },
    ];
    expect(matchSessionForCommit(candidates, REPO, '2026-03-18T10:00:00Z')).toBe('codex');
  });

  it('rejects a session whose cwd is outside the repo (sibling prefix)', () => {
    // /Users/me/proj-other should not match /Users/me/proj
    const candidates = [
      { session_type: 'claude', cwd: '/Users/me/proj-other', started_at: '2026-03-18T09:00:00Z', ended_at: null },
    ];
    expect(matchSessionForCommit(candidates, REPO, '2026-03-18T10:00:00Z')).toBeNull();
  });

  it('rejects a session that started after the commit', () => {
    const candidates = [
      { session_type: 'claude', cwd: REPO, started_at: '2026-03-18T11:00:00Z', ended_at: null },
    ];
    expect(matchSessionForCommit(candidates, REPO, '2026-03-18T10:00:00Z')).toBeNull();
  });

  it('rejects a session that ended before the commit', () => {
    const candidates = [
      { session_type: 'claude', cwd: REPO, started_at: '2026-03-18T08:00:00Z', ended_at: '2026-03-18T09:00:00Z' },
    ];
    expect(matchSessionForCommit(candidates, REPO, '2026-03-18T10:00:00Z')).toBeNull();
  });

  it('accepts an open-ended session (ended_at = null) covering the commit', () => {
    const candidates = [
      { session_type: 'gemini', cwd: REPO, started_at: '2026-03-18T08:00:00Z', ended_at: null },
    ];
    expect(matchSessionForCommit(candidates, REPO, '2026-03-18T10:00:00Z')).toBe('gemini');
  });

  it('tiebreaks by shortest cwd (session closer to repo root wins)', () => {
    const candidates = [
      { session_type: 'codex', cwd: `${REPO}/deep/nested/dir`, started_at: '2026-03-18T09:00:00Z', ended_at: null },
      { session_type: 'claude', cwd: REPO, started_at: '2026-03-18T09:00:00Z', ended_at: null },
    ];
    expect(matchSessionForCommit(candidates, REPO, '2026-03-18T10:00:00Z')).toBe('claude');
  });

  it('with equal cwd lengths, prefers the most recent started_at', () => {
    // Order intentionally NOT DESC — the comparator should sort regardless of input order.
    const candidates = [
      { session_type: 'claude', cwd: REPO, started_at: '2026-03-18T09:00:00Z', ended_at: null },
      { session_type: 'codex', cwd: REPO, started_at: '2026-03-18T09:30:00Z', ended_at: null },
    ];
    expect(matchSessionForCommit(candidates, REPO, '2026-03-18T10:00:00Z')).toBe('codex');
  });
});

describe('extractCommandString', () => {
  it('extracts command from Claude-style input', () => {
    expect(extractCommandString({ command: 'git commit -m "test"' })).toBe('git commit -m "test"');
  });

  it('extracts input from alternative field name', () => {
    expect(extractCommandString({ input: 'git push' })).toBe('git push');
  });

  it('prefers command over input when both present', () => {
    expect(extractCommandString({ command: 'git status', input: 'git push' })).toBe('git status');
  });

  it('returns empty string for null', () => {
    expect(extractCommandString(null)).toBe('');
  });

  it('returns empty string for non-command input', () => {
    expect(extractCommandString({ file: 'test.ts', content: '...' })).toBe('');
  });

  it('returns empty string for empty object', () => {
    expect(extractCommandString({})).toBe('');
  });
});
