import { describe, expect, it } from 'vitest';
import {
  parseGeminiSessionList,
  resolveGeminiResumeIndex,
  selectGeminiSessionCandidate,
} from '../../../src/main/session/gemini-session-store';

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
});
