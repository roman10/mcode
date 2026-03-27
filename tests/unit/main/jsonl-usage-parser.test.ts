import { describe, it, expect } from 'vitest';
import { parseUsageFromChunk, parseHumanMessagesFromChunk, extractLatestModel } from '../../../src/main/trackers/jsonl-usage-parser';

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

describe('parseHumanMessagesFromChunk', () => {
  it('parses a genuine human message (string content with permissionMode)', () => {
    const chunk = jsonl({
      type: 'user',
      uuid: 'human-001',
      timestamp: '2026-03-20T10:00:00Z',
      permissionMode: 'default',
      message: { role: 'user', content: 'Please fix the bug' },
    });

    const entries = parseHumanMessagesFromChunk(chunk, false);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      messageId: 'human-001',
      textLength: 18,
      wordCount: 4,
    });
  });

  it('parses human message with image+text array content', () => {
    const chunk = jsonl({
      type: 'user',
      uuid: 'human-img',
      timestamp: '2026-03-20T10:00:00Z',
      permissionMode: 'plan',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', data: 'abc' } },
          { type: 'text', text: 'check this screenshot' },
        ],
      },
    });

    const entries = parseHumanMessagesFromChunk(chunk, false);
    expect(entries).toHaveLength(1);
    expect(entries[0].textLength).toBe(21);
  });

  it('handles multiple human messages', () => {
    const chunk = jsonl(
      { type: 'user', uuid: 'h1', timestamp: 'T1', permissionMode: 'default', message: { content: 'hello' } },
      { type: 'user', uuid: 'h2', timestamp: 'T2', permissionMode: 'default', message: { content: 'world' } },
    );
    expect(parseHumanMessagesFromChunk(chunk, false)).toHaveLength(2);
  });

  it('discards first line when isPartialStart is true', () => {
    const chunk = jsonl(
      { type: 'user', uuid: 'first', timestamp: 'T1', permissionMode: 'default', message: { content: 'a' } },
      { type: 'user', uuid: 'second', timestamp: 'T2', permissionMode: 'default', message: { content: 'b' } },
    );
    const entries = parseHumanMessagesFromChunk(chunk, true);
    expect(entries).toHaveLength(1);
    expect(entries[0].messageId).toBe('second');
  });

  // --- Messages that should be filtered ---

  it('filters out tool_result messages (no permissionMode)', () => {
    const chunk = jsonl({
      type: 'user',
      uuid: 'tool-001',
      timestamp: 'T1',
      sourceToolAssistantUUID: 'asst-1',
      toolUseResult: { filePath: '/foo.ts' },
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'x', content: 'result text' }],
      },
    });
    expect(parseHumanMessagesFromChunk(chunk, false)).toHaveLength(0);
  });

  it('filters out skill expansion (isMeta, no permissionMode)', () => {
    const chunk = jsonl({
      type: 'user',
      uuid: 'meta-001',
      timestamp: 'T1',
      isMeta: true,
      message: {
        content: [{ type: 'text', text: 'Review the uncommitted code...' }],
      },
    });
    expect(parseHumanMessagesFromChunk(chunk, false)).toHaveLength(0);
  });

  it('filters out compact summary (no permissionMode)', () => {
    const chunk = jsonl({
      type: 'user',
      uuid: 'compact-001',
      timestamp: 'T1',
      isCompactSummary: true,
      message: {
        content: 'This session is being continued from a previous conversation...',
      },
    });
    expect(parseHumanMessagesFromChunk(chunk, false)).toHaveLength(0);
  });

  it('filters out slash command wrapper (no permissionMode)', () => {
    const chunk = jsonl({
      type: 'user',
      uuid: 'cmd-001',
      timestamp: 'T1',
      message: { content: '<command-message>cru</command-message>' },
    });
    expect(parseHumanMessagesFromChunk(chunk, false)).toHaveLength(0);
  });

  it('filters out local command output (no permissionMode)', () => {
    const chunk = jsonl({
      type: 'user',
      uuid: 'local-001',
      timestamp: 'T1',
      message: { content: '<local-command-stdout>some output</local-command-stdout>' },
    });
    expect(parseHumanMessagesFromChunk(chunk, false)).toHaveLength(0);
  });

  it('skips empty content', () => {
    const chunk = jsonl({
      type: 'user',
      uuid: 'empty-001',
      timestamp: 'T1',
      permissionMode: 'default',
      message: { content: '' },
    });
    expect(parseHumanMessagesFromChunk(chunk, false)).toHaveLength(0);
  });

  it('ignores non-user message types', () => {
    const chunk = jsonl(
      { type: 'assistant', uuid: 'a1', timestamp: 'T1', message: { content: 'hello' } },
      { type: 'progress', uuid: 'p1', timestamp: 'T1', data: {} },
    );
    expect(parseHumanMessagesFromChunk(chunk, false)).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(parseHumanMessagesFromChunk('', false)).toEqual([]);
    expect(parseHumanMessagesFromChunk('\n\n', false)).toEqual([]);
  });
});

describe('extractLatestModel', () => {
  it('extracts model from the last assistant message', () => {
    const chunk = jsonl(
      { type: 'assistant', uuid: 'msg-1', timestamp: 'T1', message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 1 } } },
      { type: 'assistant', uuid: 'msg-2', timestamp: 'T2', message: { model: 'claude-opus-4-6', usage: { input_tokens: 1 } } },
    );
    expect(extractLatestModel(chunk)).toBe('claude-opus-4-6');
  });

  it('returns null for empty input', () => {
    expect(extractLatestModel('')).toBeNull();
    expect(extractLatestModel('\n\n')).toBeNull();
  });

  it('skips <synthetic> model entries', () => {
    const chunk = jsonl(
      { type: 'assistant', uuid: 'msg-1', timestamp: 'T1', message: { model: 'claude-opus-4-6', usage: { input_tokens: 1 } } },
      { type: 'assistant', uuid: 'msg-2', timestamp: 'T2', message: { model: '<synthetic>', usage: { input_tokens: 1 } } },
    );
    expect(extractLatestModel(chunk)).toBe('claude-opus-4-6');
  });

  it('returns null when only non-assistant messages exist', () => {
    const chunk = jsonl(
      { type: 'user', uuid: 'u1', timestamp: 'T1', message: { content: 'hello' } },
      { type: 'progress', timestamp: 'T2', data: {} },
    );
    expect(extractLatestModel(chunk)).toBeNull();
  });

  it('handles malformed lines gracefully', () => {
    const chunk = 'not json\n' + jsonl(
      { type: 'assistant', uuid: 'msg-1', timestamp: 'T1', message: { model: 'claude-opus-4-6', usage: { input_tokens: 1 } } },
    );
    expect(extractLatestModel(chunk)).toBe('claude-opus-4-6');
  });

  it('returns null when assistant messages have no model field', () => {
    const chunk = jsonl(
      { type: 'assistant', uuid: 'msg-1', timestamp: 'T1', message: { usage: { input_tokens: 1 } } },
    );
    expect(extractLatestModel(chunk)).toBeNull();
  });
});
