import { describe, it, expect } from 'vitest';
import {
  selectCodexThreadCandidate,
  type CodexThreadRecord,
} from '../../../src/main/session/codex-session-store';

function makeThread(overrides: Partial<CodexThreadRecord> = {}): CodexThreadRecord {
  return {
    id: 'thread-1',
    cwd: '/repo',
    title: 'title',
    firstUserMessage: 'prompt',
    createdAtMs: 1_000_000,
    updatedAtMs: 1_000_000,
    ...overrides,
  };
}

describe('selectCodexThreadCandidate', () => {
  it('prefers exact first-user-message match', () => {
    const result = selectCodexThreadCandidate([
      makeThread({ id: 'older', firstUserMessage: 'other', createdAtMs: 1_000_100 }),
      makeThread({ id: 'exact', firstUserMessage: 'build feature', createdAtMs: 1_000_200 }),
    ], {
      cwd: '/repo',
      initialPrompt: 'build feature',
      startedAtMs: 1_000_000,
      nowMs: 1_002_000,
      claimedThreadIds: new Set(),
    });

    expect(result?.id).toBe('exact');
  });

  it('falls back to exact title match', () => {
    const result = selectCodexThreadCandidate([
      makeThread({ id: 'title-match', title: 'debug failing test', firstUserMessage: 'different' }),
    ], {
      cwd: '/repo',
      initialPrompt: 'debug failing test',
      startedAtMs: 1_000_000,
      nowMs: 1_002_000,
      claimedThreadIds: new Set(),
    });

    expect(result?.id).toBe('title-match');
  });

  it('returns the only eligible candidate when prompt is absent', () => {
    const result = selectCodexThreadCandidate([
      makeThread({ id: 'only-one', firstUserMessage: '', title: '' }),
    ], {
      cwd: '/repo',
      startedAtMs: 1_000_000,
      nowMs: 1_002_000,
      claimedThreadIds: new Set(),
    });

    expect(result?.id).toBe('only-one');
  });

  it('returns null when multiple exact prompt matches exist', () => {
    const result = selectCodexThreadCandidate([
      makeThread({ id: 'a', firstUserMessage: 'same' }),
      makeThread({ id: 'b', firstUserMessage: 'same', createdAtMs: 1_000_500 }),
    ], {
      cwd: '/repo',
      initialPrompt: 'same',
      startedAtMs: 1_000_000,
      nowMs: 1_002_000,
      claimedThreadIds: new Set(),
    });

    expect(result).toBeNull();
  });

  it('ignores already-claimed thread IDs', () => {
    const result = selectCodexThreadCandidate([
      makeThread({ id: 'claimed' }),
      makeThread({ id: 'free', firstUserMessage: 'next prompt' }),
    ], {
      cwd: '/repo',
      initialPrompt: 'next prompt',
      startedAtMs: 1_000_000,
      nowMs: 1_002_000,
      claimedThreadIds: new Set(['claimed']),
    });

    expect(result?.id).toBe('free');
  });

  it('ignores threads outside the capture window', () => {
    const result = selectCodexThreadCandidate([
      makeThread({ id: 'too-old', createdAtMs: 900_000 }),
    ], {
      cwd: '/repo',
      initialPrompt: 'prompt',
      startedAtMs: 1_000_000,
      nowMs: 1_002_000,
      claimedThreadIds: new Set(),
    });

    expect(result).toBeNull();
  });
});
