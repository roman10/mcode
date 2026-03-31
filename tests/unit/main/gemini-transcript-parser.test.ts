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

    expect(entries[0]).toEqual({
      messageId: 'gemini:session-1:msg-2',
      model: 'gemini-3-flash',
      inputTokens: 9390, // input + tool(0)
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
      inputTokens: 1010, // input(1000) + tool(10)
      outputTokens: 80,  // output(50) + thoughts(30)
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 200,
      isFastMode: false,
      timestamp: '2026-03-31T12:00:15Z',
    });
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
});
