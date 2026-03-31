import { describe, it, expect } from 'vitest';
import { parseCodexTranscript } from '../../../src/main/trackers/codex-transcript-parser';

// Helper to build a JSONL string from an array of event objects.
function jsonl(...events: object[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n');
}

const SESSION_META = {
  type: 'session_meta',
  timestamp: '2026-03-27T00:25:03Z',
  payload: { id: 'sess-abc', cwd: '/Users/dev/my-project' },
};

const TURN_CONTEXT = {
  type: 'turn_context',
  timestamp: '2026-03-27T00:25:03Z',
  payload: { model: 'gpt-5.4', effort: 'high', cwd: '/Users/dev/my-project' },
};

const TOKEN_COUNT_1 = {
  type: 'event_msg',
  timestamp: '2026-03-27T00:25:12.011Z',
  payload: {
    type: 'token_count',
    info: {
      last_token_usage: {
        input_tokens: 11288,
        cached_input_tokens: 9600,
        output_tokens: 294,
        reasoning_output_tokens: 96,
        total_tokens: 11582,
      },
    },
  },
};

const TOKEN_COUNT_2 = {
  type: 'event_msg',
  timestamp: '2026-03-27T00:25:19.280Z',
  payload: {
    type: 'token_count',
    info: {
      last_token_usage: {
        input_tokens: 14515,
        cached_input_tokens: 12000,
        output_tokens: 345,
        reasoning_output_tokens: 141,
        total_tokens: 14860,
      },
    },
  },
};

const TOKEN_COUNT_NULL = {
  type: 'event_msg',
  timestamp: '2026-03-27T00:25:07Z',
  payload: { type: 'token_count', info: null },
};

const USER_MESSAGE = {
  type: 'event_msg',
  timestamp: '2026-03-27T00:25:03.728Z',
  payload: {
    type: 'user_message',
    message: 'list the files in the current directory',
  },
};

describe('parseCodexTranscript', () => {
  it('extracts session metadata', () => {
    const result = parseCodexTranscript(jsonl(SESSION_META));
    expect(result.sessionId).toBe('sess-abc');
    expect(result.projectDir).toBe('my-project');
  });

  it('extracts token entries with correct field mapping', () => {
    const result = parseCodexTranscript(jsonl(SESSION_META, TURN_CONTEXT, TOKEN_COUNT_1, TOKEN_COUNT_2));
    expect(result.tokenEntries).toHaveLength(2);

    expect(result.tokenEntries[0]).toEqual({
      messageId: 'codex:sess-abc:2026-03-27T00:25:12.011Z',
      model: 'gpt-5.4',
      inputTokens: 11288,
      outputTokens: 294,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 9600,
      isFastMode: false,
      timestamp: '2026-03-27T00:25:12.011Z',
    });

    expect(result.tokenEntries[1]).toEqual({
      messageId: 'codex:sess-abc:2026-03-27T00:25:19.280Z',
      model: 'gpt-5.4',
      inputTokens: 14515,
      outputTokens: 345,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 12000,
      isFastMode: false,
      timestamp: '2026-03-27T00:25:19.280Z',
    });
  });

  it('tracks model from turn_context across turns', () => {
    const turn2 = {
      type: 'turn_context',
      timestamp: '2026-03-27T00:33:25Z',
      payload: { model: 'gpt-5.1-codex-mini', effort: 'medium' },
    };
    const result = parseCodexTranscript(jsonl(SESSION_META, TURN_CONTEXT, TOKEN_COUNT_1, turn2, TOKEN_COUNT_2));
    expect(result.tokenEntries[0].model).toBe('gpt-5.4');
    expect(result.tokenEntries[1].model).toBe('gpt-5.1-codex-mini');
  });

  it('skips token_count events where info is null (rate-limited)', () => {
    const result = parseCodexTranscript(jsonl(SESSION_META, TURN_CONTEXT, TOKEN_COUNT_NULL, TOKEN_COUNT_1));
    expect(result.tokenEntries).toHaveLength(1);
    expect(result.tokenEntries[0].inputTokens).toBe(11288);
  });

  it('skips token_count events before model is known', () => {
    const result = parseCodexTranscript(jsonl(SESSION_META, TOKEN_COUNT_1));
    expect(result.tokenEntries).toHaveLength(0);
  });

  it('skips token_count events before session_meta', () => {
    const result = parseCodexTranscript(jsonl(TURN_CONTEXT, TOKEN_COUNT_1));
    expect(result.tokenEntries).toHaveLength(0);
  });

  it('extracts human input from user_message events', () => {
    const result = parseCodexTranscript(jsonl(SESSION_META, USER_MESSAGE));
    expect(result.humanEntries).toHaveLength(1);

    expect(result.humanEntries[0]).toEqual({
      messageId: 'codex:sess-abc:2026-03-27T00:25:03.728Z',
      timestamp: '2026-03-27T00:25:03.728Z',
      textLength: 39,
      wordCount: 7,
      text: 'list the files in the current directory',
    });
  });

  it('skips user_message events with empty message', () => {
    const empty = { type: 'event_msg', timestamp: '2026-01-01T00:00:00Z', payload: { type: 'user_message', message: '' } };
    const result = parseCodexTranscript(jsonl(SESSION_META, empty));
    expect(result.humanEntries).toHaveLength(0);
  });

  it('handles empty input', () => {
    const result = parseCodexTranscript('');
    expect(result.sessionId).toBeNull();
    expect(result.projectDir).toBeNull();
    expect(result.tokenEntries).toEqual([]);
    expect(result.humanEntries).toEqual([]);
  });

  it('handles malformed lines gracefully', () => {
    const content = 'not json\n' + JSON.stringify(SESSION_META) + '\n{broken\n' + JSON.stringify(TURN_CONTEXT) + '\n' + JSON.stringify(TOKEN_COUNT_1);
    const result = parseCodexTranscript(content);
    expect(result.sessionId).toBe('sess-abc');
    expect(result.tokenEntries).toHaveLength(1);
  });
});
