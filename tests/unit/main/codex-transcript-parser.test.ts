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

    // inputTokens stores the uncached slice; cached_input_tokens is a subset of input_tokens
    // in the OpenAI Responses API, so uncached = input_tokens - cached_input_tokens.
    expect(result.tokenEntries[0]).toEqual({
      messageId: 'codex:sess-abc:2026-03-27T00:25:12.011Z',
      model: 'gpt-5.4',
      inputTokens: 11288 - 9600,
      outputTokens: 294,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 9600,
      isFastMode: false,
      timestamp: '2026-03-27T00:25:12.011Z',
      contextWindow: null,
    });
    // Round-trip: stored uncached + cacheRead equals the API-reported input_tokens.
    expect(result.tokenEntries[0].inputTokens + result.tokenEntries[0].cacheReadTokens).toBe(11288);

    expect(result.tokenEntries[1]).toEqual({
      messageId: 'codex:sess-abc:2026-03-27T00:25:19.280Z',
      model: 'gpt-5.4',
      inputTokens: 14515 - 12000,
      outputTokens: 345,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 12000,
      isFastMode: false,
      timestamp: '2026-03-27T00:25:19.280Z',
      contextWindow: null,
    });
  });

  it('extracts model_context_window when present', () => {
    const withWindow = {
      type: 'event_msg',
      timestamp: '2026-03-27T00:25:30Z',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 134284,
            cached_input_tokens: 130944,
            output_tokens: 518,
            reasoning_output_tokens: 303,
            total_tokens: 134802,
          },
          model_context_window: 258400,
        },
      },
    };
    const result = parseCodexTranscript(jsonl(SESSION_META, TURN_CONTEXT, withWindow));
    expect(result.tokenEntries).toHaveLength(1);
    expect(result.tokenEntries[0].contextWindow).toBe(258400);
  });

  it('sets contextWindow to null when model_context_window is absent', () => {
    const result = parseCodexTranscript(jsonl(SESSION_META, TURN_CONTEXT, TOKEN_COUNT_1));
    expect(result.tokenEntries[0].contextWindow).toBeNull();
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
    expect(result.tokenEntries[0].inputTokens).toBe(11288 - 9600);
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

  it('handles missing nested fields in token_count payload', () => {
    const broken = {
      type: 'event_msg',
      timestamp: '2026-03-27T00:25:12Z',
      payload: { type: 'token_count', info: { last_token_usage: {} } },
    };
    const result = parseCodexTranscript(jsonl(SESSION_META, TURN_CONTEXT, broken));
    expect(result.tokenEntries).toHaveLength(1);
    expect(result.tokenEntries[0].inputTokens).toBe(0);
  });

  it('handles missing payload entirely', () => {
    const broken = { type: 'event_msg', timestamp: '2026-03-27T00:25:12Z' };
    const result = parseCodexTranscript(jsonl(SESSION_META, TURN_CONTEXT, broken));
    expect(result.tokenEntries).toHaveLength(0);
  });

  it('handles non-string timestamp gracefully by falling back to current time', () => {
    const broken = {
      type: 'event_msg',
      timestamp: 123456789,
      payload: { type: 'user_message', message: 'hello' },
    };
    const result = parseCodexTranscript(jsonl(SESSION_META, broken));
    expect(result.humanEntries).toHaveLength(1);
    expect(typeof result.humanEntries[0].timestamp).toBe('string');
    expect(result.humanEntries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
