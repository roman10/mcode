import { describe, it, expect } from 'vitest';
import { parseUsageFromChunk } from '../../../src/main/jsonl-usage-parser';

function jsonl(...lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n');
}

describe('parseUsageFromChunk', () => {
  it('parses an assistant message', () => {
    const chunk = jsonl({
      type: 'assistant',
      uuid: 'msg-001',
      timestamp: '2026-03-20T10:00:00Z',
      message: {
        model: 'claude-opus-4-6',
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 200,
        },
      },
    });

    const entries = parseUsageFromChunk(chunk, false);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      messageId: 'msg-001',
      model: 'claude-opus-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      isFastMode: false,
    });
  });

  it('parses a progress message (sub-agent)', () => {
    const chunk = jsonl({
      type: 'progress',
      timestamp: '2026-03-20T10:00:00Z',
      data: {
        message: {
          message: {
            id: 'inner-001',
            model: 'claude-sonnet-4-5',
            usage: {
              input_tokens: 2000,
              output_tokens: 800,
            },
          },
        },
      },
    });

    const entries = parseUsageFromChunk(chunk, false);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      messageId: 'inner-001',
      model: 'claude-sonnet-4-5',
      inputTokens: 2000,
      outputTokens: 800,
    });
  });

  it('skips malformed JSON lines', () => {
    const chunk = 'not json\n' + jsonl({
      type: 'assistant',
      uuid: 'msg-002',
      timestamp: '2026-03-20T10:00:00Z',
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });

    const entries = parseUsageFromChunk(chunk, false);
    expect(entries).toHaveLength(1);
    expect(entries[0].messageId).toBe('msg-002');
  });

  it('discards first line when isPartialStart is true', () => {
    const chunk = jsonl(
      { type: 'assistant', uuid: 'first', timestamp: 'T1', message: { model: 'claude-opus-4-6', usage: { input_tokens: 1 } } },
      { type: 'assistant', uuid: 'second', timestamp: 'T2', message: { model: 'claude-opus-4-6', usage: { input_tokens: 2 } } },
    );

    const entries = parseUsageFromChunk(chunk, true);
    expect(entries).toHaveLength(1);
    expect(entries[0].messageId).toBe('second');
  });

  it('skips <synthetic> model entries', () => {
    const chunk = jsonl({
      type: 'assistant',
      uuid: 'msg-syn',
      timestamp: '2026-03-20T10:00:00Z',
      message: { model: '<synthetic>', usage: { input_tokens: 1 } },
    });

    expect(parseUsageFromChunk(chunk, false)).toHaveLength(0);
  });

  it('skips entries missing required fields', () => {
    // No uuid
    const noUuid = jsonl({ type: 'assistant', timestamp: 'T1', message: { model: 'x', usage: {} } });
    expect(parseUsageFromChunk(noUuid, false)).toHaveLength(0);

    // No message
    const noMsg = jsonl({ type: 'assistant', uuid: 'u', timestamp: 'T1' });
    expect(parseUsageFromChunk(noMsg, false)).toHaveLength(0);

    // No model
    const noModel = jsonl({ type: 'assistant', uuid: 'u', timestamp: 'T1', message: { usage: {} } });
    expect(parseUsageFromChunk(noModel, false)).toHaveLength(0);
  });

  it('handles cache_creation breakdown', () => {
    const chunk = jsonl({
      type: 'assistant',
      uuid: 'msg-cache',
      timestamp: '2026-03-20T10:00:00Z',
      message: {
        model: 'claude-opus-4-6',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation: {
            ephemeral_5m_input_tokens: 300,
            ephemeral_1h_input_tokens: 700,
          },
        },
      },
    });

    const entries = parseUsageFromChunk(chunk, false);
    expect(entries[0].cacheWrite5mTokens).toBe(300);
    expect(entries[0].cacheWrite1hTokens).toBe(700);
  });

  it('falls back to cache_creation_input_tokens when no breakdown', () => {
    const chunk = jsonl({
      type: 'assistant',
      uuid: 'msg-legacy',
      timestamp: '2026-03-20T10:00:00Z',
      message: {
        model: 'claude-opus-4-6',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 500,
        },
      },
    });

    const entries = parseUsageFromChunk(chunk, false);
    expect(entries[0].cacheWrite5mTokens).toBe(0);
    expect(entries[0].cacheWrite1hTokens).toBe(500);
  });

  it('detects fast mode from speed field', () => {
    const chunk = jsonl({
      type: 'assistant',
      uuid: 'msg-fast',
      timestamp: '2026-03-20T10:00:00Z',
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 1, output_tokens: 1, speed: 'fast' },
      },
    });

    const entries = parseUsageFromChunk(chunk, false);
    expect(entries[0].isFastMode).toBe(true);
  });

  it('returns empty array for empty input', () => {
    expect(parseUsageFromChunk('', false)).toEqual([]);
    expect(parseUsageFromChunk('\n\n', false)).toEqual([]);
  });

  it('ignores unrecognized type fields', () => {
    const chunk = jsonl(
      { type: 'system', data: {} },
      { type: 'user', data: {} },
    );
    expect(parseUsageFromChunk(chunk, false)).toEqual([]);
  });
});
