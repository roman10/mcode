import { describe, it, expect } from 'vitest';
import {
  parseGeminiTranscriptTokens,
  parseGeminiTranscriptHumanMessages,
} from '../../../src/main/trackers/gemini-transcript-parser';

const SAMPLE_TRANSCRIPT = JSON.stringify({
  sessionId: 'abc-123',
  projectHash: 'hash123',
  startTime: '2026-03-31T12:00:00Z',
  lastUpdated: '2026-03-31T12:01:00Z',
  messages: [
    {
      id: 'msg-1',
      timestamp: '2026-03-31T12:00:01Z',
      type: 'user',
      content: [{ text: 'say hello world' }],
    },
    {
      id: 'msg-2',
      timestamp: '2026-03-31T12:00:05Z',
      type: 'gemini',
      content: 'hello world',
      tokens: { input: 9390, output: 2, cached: 0, thoughts: 111, tool: 0, total: 9503 },
      model: 'gemini-3-flash-preview',
    },
    {
      id: 'msg-3',
      timestamp: '2026-03-31T12:00:10Z',
      type: 'user',
      content: [{ text: 'list the files' }],
    },
    {
      id: 'msg-4',
      timestamp: '2026-03-31T12:00:15Z',
      type: 'gemini',
      content: 'file1.ts\nfile2.ts',
      tokens: { input: 1000, output: 50, cached: 200, thoughts: 30, tool: 10, total: 1290 },
      model: 'models/gemini-2.5-pro-preview-05-06',
    },
  ],
  kind: 'main',
});

describe('parseGeminiTranscriptTokens', () => {
  it('extracts token entries from gemini messages', () => {
    const entries = parseGeminiTranscriptTokens(SAMPLE_TRANSCRIPT, 'session-1');
    expect(entries).toHaveLength(2);

    // inputTokens stores the uncached slice: (input + tool) - cached.
    // Gemini's `input` is the full promptTokenCount, which includes cached tokens.
    expect(entries[0]).toEqual({
      messageId: 'gemini:session-1:msg-2',
      model: 'gemini-3-flash',
      inputTokens: 9390, // (input 9390 + tool 0) - cached 0
      outputTokens: 113, // output(2) + thoughts(111)
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 0,
      isFastMode: false,
      timestamp: '2026-03-31T12:00:05Z',
    });

    expect(entries[1]).toEqual({
      messageId: 'gemini:session-1:msg-4',
      model: 'gemini-2.5-pro',
      inputTokens: 810,  // (input 1000 + tool 10) - cached 200
      outputTokens: 80,  // output(50) + thoughts(30)
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 200,
      isFastMode: false,
      timestamp: '2026-03-31T12:00:15Z',
    });
    // Round-trip invariant: stored uncached + cacheRead == API-reported (input + tool).
    expect(entries[1].inputTokens + entries[1].cacheReadTokens).toBe(1010);
  });

  it('skips user messages', () => {
    const transcript = JSON.stringify({
      messages: [
        { id: 'u1', type: 'user', content: 'hello' },
      ],
    });
    expect(parseGeminiTranscriptTokens(transcript, 's')).toEqual([]);
  });

  it('skips gemini messages without tokens', () => {
    const transcript = JSON.stringify({
      messages: [
        { id: 'g1', type: 'gemini', content: 'hello', model: 'gemini-3-flash' },
      ],
    });
    expect(parseGeminiTranscriptTokens(transcript, 's')).toEqual([]);
  });

  it('skips gemini messages without model', () => {
    const transcript = JSON.stringify({
      messages: [
        { id: 'g1', type: 'gemini', content: 'hello', tokens: { input: 1, output: 1, total: 2 } },
      ],
    });
    expect(parseGeminiTranscriptTokens(transcript, 's')).toEqual([]);
  });

  it('skips messages without id', () => {
    const transcript = JSON.stringify({
      messages: [
        { type: 'gemini', content: 'hello', tokens: { input: 1, output: 1, total: 2 }, model: 'gemini-3-flash' },
      ],
    });
    expect(parseGeminiTranscriptTokens(transcript, 's')).toEqual([]);
  });

  it('handles empty messages array', () => {
    const transcript = JSON.stringify({ messages: [] });
    expect(parseGeminiTranscriptTokens(transcript, 's')).toEqual([]);
  });

  it('handles missing messages field', () => {
    const transcript = JSON.stringify({ sessionId: 'abc' });
    expect(parseGeminiTranscriptTokens(transcript, 's')).toEqual([]);
  });

  it('handles invalid JSON', () => {
    expect(parseGeminiTranscriptTokens('not json', 's')).toEqual([]);
  });

  it('defaults missing token fields to zero', () => {
    const transcript = JSON.stringify({
      messages: [
        { id: 'g1', timestamp: '2026-01-01T00:00:00Z', type: 'gemini', content: 'hello',
          tokens: { input: 100, total: 100 }, model: 'gemini-3-flash' },
      ],
    });
    const entries = parseGeminiTranscriptTokens(transcript, 's');
    expect(entries).toHaveLength(1);
    expect(entries[0].inputTokens).toBe(100);
    expect(entries[0].outputTokens).toBe(0);
    expect(entries[0].cacheReadTokens).toBe(0);
  });
});

describe('parseGeminiTranscriptHumanMessages', () => {
  it('extracts human messages from user content', () => {
    const entries = parseGeminiTranscriptHumanMessages(SAMPLE_TRANSCRIPT);
    expect(entries).toHaveLength(2);

    expect(entries[0]).toEqual({
      messageId: 'gemini:msg-1',
      timestamp: '2026-03-31T12:00:01Z',
      textLength: 15,
      wordCount: 3,
      text: 'say hello world',
    });

    expect(entries[1]).toEqual({
      messageId: 'gemini:msg-3',
      timestamp: '2026-03-31T12:00:10Z',
      textLength: 14,
      wordCount: 3,
      text: 'list the files',
    });
  });

  it('handles string content', () => {
    const transcript = JSON.stringify({
      messages: [
        { id: 'u1', timestamp: '2026-01-01T00:00:00Z', type: 'user', content: 'hello world' },
      ],
    });
    const entries = parseGeminiTranscriptHumanMessages(transcript);
    expect(entries).toHaveLength(1);
    expect(entries[0].textLength).toBe(11);
    expect(entries[0].wordCount).toBe(2);
  });

  it('skips gemini messages', () => {
    const transcript = JSON.stringify({
      messages: [
        { id: 'g1', timestamp: '2026-01-01T00:00:00Z', type: 'gemini', content: 'hello' },
      ],
    });
    expect(parseGeminiTranscriptHumanMessages(transcript)).toEqual([]);
  });

  it('skips user messages without content', () => {
    const transcript = JSON.stringify({
      messages: [
        { id: 'u1', timestamp: '2026-01-01T00:00:00Z', type: 'user' },
      ],
    });
    expect(parseGeminiTranscriptHumanMessages(transcript)).toEqual([]);
  });

  it('handles invalid JSON', () => {
    expect(parseGeminiTranscriptHumanMessages('{')).toEqual([]);
  });

  it('handles missing messages field', () => {
    const transcript = JSON.stringify({ sessionId: 'abc' });
    expect(parseGeminiTranscriptHumanMessages(transcript)).toEqual([]);
  });

  it('handles missing nested fields in message content', () => {
    const transcript = JSON.stringify({
      messages: [
        { id: 'u1', type: 'user', content: [{ unexpected: 'format' }] },
      ],
    });
    expect(parseGeminiTranscriptHumanMessages(transcript)).toEqual([]);
  });

  it('handles non-array content in message', () => {
    const transcript = JSON.stringify({
      messages: [
        { id: 'u1', type: 'user', content: 42 },
      ],
    });
    expect(parseGeminiTranscriptHumanMessages(transcript)).toEqual([]);
  });
});

// Gemini CLI changed the on-disk format around 2026-04-22 to JSONL: line 1 is
// a header (no `id`/`type`), subsequent lines are individual messages, and
// `{"$set":{...}}` lines are mongo-style update markers that must be skipped.
const JSONL_TRANSCRIPT = [
  JSON.stringify({
    sessionId: 'jsonl-session',
    projectHash: 'hash999',
    startTime: '2026-04-27T23:00:00Z',
    lastUpdated: '2026-04-27T23:00:00Z',
    kind: 'main',
  }),
  JSON.stringify({
    id: 'msg-1',
    timestamp: '2026-04-27T23:00:01Z',
    type: 'user',
    content: [{ text: 'say hello world' }],
  }),
  JSON.stringify({ $set: { lastUpdated: '2026-04-27T23:00:01.500Z' } }),
  JSON.stringify({
    id: 'msg-2',
    timestamp: '2026-04-27T23:00:05Z',
    type: 'gemini',
    content: 'hello world',
    tokens: { input: 9390, output: 2, cached: 0, thoughts: 111, tool: 0, total: 9503 },
    model: 'gemini-3-flash-preview',
  }),
  JSON.stringify({ $set: { lastUpdated: '2026-04-27T23:00:05.500Z' } }),
  JSON.stringify({
    id: 'msg-3',
    timestamp: '2026-04-27T23:00:10Z',
    type: 'user',
    content: [{ text: 'list the files' }],
  }),
  JSON.stringify({
    id: 'msg-4',
    timestamp: '2026-04-27T23:00:15Z',
    type: 'gemini',
    content: 'file1.ts\nfile2.ts',
    tokens: { input: 1000, output: 50, cached: 200, thoughts: 30, tool: 10, total: 1290 },
    model: 'models/gemini-2.5-pro-preview-05-06',
  }),
  '', // trailing newline
].join('\n');

describe('JSONL format support', () => {
  it('parses tokens from a JSONL transcript identically to legacy JSON', () => {
    const jsonlEntries = parseGeminiTranscriptTokens(JSONL_TRANSCRIPT, 'session-1');
    const legacyEntries = parseGeminiTranscriptTokens(SAMPLE_TRANSCRIPT, 'session-1');

    // Same models, same token math, same shape — only timestamps differ
    expect(jsonlEntries.map((e) => e.model)).toEqual(legacyEntries.map((e) => e.model));
    expect(jsonlEntries.map((e) => e.inputTokens)).toEqual(legacyEntries.map((e) => e.inputTokens));
    expect(jsonlEntries.map((e) => e.outputTokens)).toEqual(legacyEntries.map((e) => e.outputTokens));
    expect(jsonlEntries.map((e) => e.cacheReadTokens)).toEqual(legacyEntries.map((e) => e.cacheReadTokens));
  });

  it('parses human messages from a JSONL transcript', () => {
    const entries = parseGeminiTranscriptHumanMessages(JSONL_TRANSCRIPT);
    expect(entries).toHaveLength(2);
    expect(entries[0].text).toBe('say hello world');
    expect(entries[1].text).toBe('list the files');
  });

  it('skips $set update lines and the header line', () => {
    // The header has no `id`/`type`; the $set lines have neither but match
    // neither user nor gemini types. Without skipping them, we'd see extra
    // entries or throw on missing fields.
    const tokens = parseGeminiTranscriptTokens(JSONL_TRANSCRIPT, 's');
    const humans = parseGeminiTranscriptHumanMessages(JSONL_TRANSCRIPT);
    expect(tokens).toHaveLength(2); // only the two `type:"gemini"` messages
    expect(humans).toHaveLength(2); // only the two `type:"user"` messages
  });

  it('does NOT fall through to JSONL parsing when whole-file JSON parses but lacks messages', () => {
    // A valid single-JSON object whose top level happens to look like a single
    // message (id+type) must still return []. Falling through to JSONL would
    // mis-treat it as one line of a JSONL stream and surface a phantom message.
    const messageLikeButNotJsonl = JSON.stringify({
      id: 'g1', type: 'gemini', content: 'x',
      tokens: { input: 1, output: 1, total: 2 }, model: 'gemini-3-flash',
    });
    expect(parseGeminiTranscriptTokens(messageLikeButNotJsonl, 's')).toEqual([]);
    expect(parseGeminiTranscriptHumanMessages(messageLikeButNotJsonl)).toEqual([]);
  });

  it('tolerates malformed JSONL lines mid-stream', () => {
    const content = [
      JSON.stringify({ sessionId: 'x', kind: 'main' }),
      'not-json-{',
      JSON.stringify({
        id: 'g1', timestamp: '2026-04-27T00:00:00Z', type: 'gemini', content: 'ok',
        tokens: { input: 10, output: 1, total: 11 }, model: 'gemini-3-flash',
      }),
    ].join('\n');
    expect(parseGeminiTranscriptTokens(content, 's')).toHaveLength(1);
  });
});
