import { describe, expect, it, vi } from 'vitest';
import {
  parseGeminiSessionList,
  resolveGeminiResumeIndex,
  selectGeminiSessionCandidate,
} from '../../../src/main/session/gemini-session-store';

vi.mock('../../../src/main/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const sampleOutput = `Available sessions for this project (2):
  1. copy the CLAUDE.md to the GEMINI.md (9 hours ago) [e1bbfe0c-879b-4c8d-84c2-e9308e90fcee]
  2. Add Gemini CLI support to mcode. (Just now) [841c493b-990e-4fd8-bda0-aae347eda41b]
Loaded cached credentials.`;

describe('gemini-session-store', () => {
  it('parses Gemini session list output', () => {
    expect(parseGeminiSessionList(sampleOutput)).toEqual([
      {
        index: 1,
        title: 'copy the CLAUDE.md to the GEMINI.md',
        relativeAgeText: '9 hours ago',
        geminiSessionId: 'e1bbfe0c-879b-4c8d-84c2-e9308e90fcee',
      },
      {
        index: 2,
        title: 'Add Gemini CLI support to mcode.',
        relativeAgeText: 'Just now',
        geminiSessionId: '841c493b-990e-4fd8-bda0-aae347eda41b',
      },
    ]);
  });

  it('prefers an exact title match when selecting a capture candidate', () => {
    const entries = parseGeminiSessionList(sampleOutput);
    const candidate = selectGeminiSessionCandidate(entries, {
      initialPrompt: 'copy the CLAUDE.md to the GEMINI.md',
      claimedSessionIds: new Set(),
    });

    expect(candidate?.index).toBe(1);
  });

  it('falls back to the newest unclaimed session when prompt matching fails', () => {
    const entries = parseGeminiSessionList(sampleOutput);
    const candidate = selectGeminiSessionCandidate(entries, {
      initialPrompt: 'different task',
      claimedSessionIds: new Set(['e1bbfe0c-879b-4c8d-84c2-e9308e90fcee']),
    });

    expect(candidate?.index).toBe(2);
  });

  it('resolves the current resume index from a stored Gemini session ID', () => {
    const entries = parseGeminiSessionList(sampleOutput);
    expect(resolveGeminiResumeIndex(entries, '841c493b-990e-4fd8-bda0-aae347eda41b')).toBe(2);
    expect(resolveGeminiResumeIndex(entries, 'missing')).toBeNull();
  });

  it('ignores malformed or invalid session list lines', () => {
    expect(parseGeminiSessionList([
      'Available sessions for this project (4):',
      '  not a session line',
      '  0. bad index (just now) [invalid-zero]',
      '  3. Valid title (moments ago) [valid-id]',
      '  4. Another title [no-age] [valid-id-2]',
      '  5. Missing bracket age (just now valid-id-3',
      'Loaded cached credentials.',
    ].join('\n'))).toEqual([
      {
        index: 3,
        title: 'Valid title',
        relativeAgeText: 'moments ago',
        geminiSessionId: 'valid-id',
      },
    ]);
  });

  it('handles titles with special characters', () => {
    const output = `Available sessions for this project (1):
  1. Title with (parens) and [brackets] (1 hour ago) [uuid-123]`;
    expect(parseGeminiSessionList(output)).toEqual([
      {
        index: 1,
        title: 'Title with (parens) and [brackets]',
        relativeAgeText: '1 hour ago',
        geminiSessionId: 'uuid-123',
      },
    ]);
  });

  it('handles very long session lists', () => {
    const lines = ['Available sessions for this project (100):'];
    for (let i = 1; i <= 100; i++) {
      lines.push(`  ${i}. Session ${i} (day ago) [uuid-${i}]`);
    }
    const result = parseGeminiSessionList(lines.join('\n'));
    expect(result).toHaveLength(100);
    expect(result[99].index).toBe(100);
    expect(result[99].geminiSessionId).toBe('uuid-100');
  });

  it('returns null when every listed Gemini session is already claimed', () => {
    const entries = parseGeminiSessionList(sampleOutput);
    expect(selectGeminiSessionCandidate(entries, {
      initialPrompt: 'Add Gemini CLI support to mcode.',
      claimedSessionIds: new Set([
        'e1bbfe0c-879b-4c8d-84c2-e9308e90fcee',
        '841c493b-990e-4fd8-bda0-aae347eda41b',
      ]),
    })).toBeNull();
  });

  it('logs a warning when output has content but no parseable sessions', async () => {
    const { logger } = await import('../../../src/main/logger');
    vi.mocked(logger.warn).mockClear();

    const result = parseGeminiSessionList([
      'Gemini CLI v1.0',
      'Some unexpected output format',
      'No sessions here',
    ].join('\n'));

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      'gemini-session-store',
      'Gemini --list-sessions output had content but no parseable sessions',
      expect.objectContaining({ nonEmptyLines: 3 }),
    );
  });

  it('does not log warning when output is empty', async () => {
    const { logger } = await import('../../../src/main/logger');
    vi.mocked(logger.warn).mockClear();

    parseGeminiSessionList('');
    parseGeminiSessionList('\n\n');

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not log warning when sessions are successfully parsed', async () => {
    const { logger } = await import('../../../src/main/logger');
    vi.mocked(logger.warn).mockClear();

    parseGeminiSessionList(sampleOutput);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
