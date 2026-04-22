import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { McpTestClient } from '../mcp-client';
import { resetTestState } from '../helpers';

/**
 * Gemini token tracking integration test.
 *
 * Writes a synthetic Gemini transcript JSON to ~/.gemini/tmp/ so the
 * GeminiScanner discovers it during tokens_refresh. Verifies that token
 * data, model, and cost estimates appear correctly in query results.
 */

const GEMINI_SESSION_ID = `test-gemini-tokens-${Date.now()}`;
const PROJECT_DIR = 'test-integration';
const TRANSCRIPT_DIR = join(homedir(), '.gemini', 'tmp', PROJECT_DIR, 'chats');
const TRANSCRIPT_PATH = join(TRANSCRIPT_DIR, `session-${GEMINI_SESSION_ID}.json`);

// Known token values for assertions
const MSG1_INPUT = 9390;
const MSG1_TOOL = 120;
const MSG1_OUTPUT = 42;
const MSG1_THOUGHTS = 111;
const MSG1_CACHED = 50;

const MSG2_INPUT = 5000;
const MSG2_TOOL = 0;
const MSG2_OUTPUT = 200;
const MSG2_THOUGHTS = 80;
const MSG2_CACHED = 0;

// Gemini's `input` is the full promptTokenCount (includes cached). The parser
// stores only the uncached slice in `inputTokens`, with cached tracked separately.
const TOTAL_RAW_PROMPT = (MSG1_INPUT + MSG1_TOOL) + (MSG2_INPUT + MSG2_TOOL);
const TOTAL_CACHE_READ = MSG1_CACHED + MSG2_CACHED;
const TOTAL_INPUT_UNCACHED = TOTAL_RAW_PROMPT - TOTAL_CACHE_READ;
const TOTAL_OUTPUT = (MSG1_OUTPUT + MSG1_THOUGHTS) + (MSG2_OUTPUT + MSG2_THOUGHTS);

const MODEL_NAME = 'gemini-3-flash-preview';

function makeTranscript(): string {
  return JSON.stringify({
    sessionId: GEMINI_SESSION_ID,
    projectHash: 'abc123',
    startTime: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    messages: [
      {
        id: 'msg-user-1',
        timestamp: new Date().toISOString(),
        type: 'user',
        content: [{ text: 'say hello world' }],
      },
      {
        id: 'msg-gemini-1',
        timestamp: new Date().toISOString(),
        type: 'gemini',
        model: MODEL_NAME,
        tokens: {
          input: MSG1_INPUT,
          output: MSG1_OUTPUT,
          cached: MSG1_CACHED,
          thoughts: MSG1_THOUGHTS,
          tool: MSG1_TOOL,
          total: MSG1_INPUT + MSG1_OUTPUT + MSG1_CACHED + MSG1_THOUGHTS + MSG1_TOOL,
        },
        content: 'hello world',
      },
      {
        id: 'msg-user-2',
        timestamp: new Date().toISOString(),
        type: 'user',
        content: [{ text: 'now explain it' }],
      },
      {
        id: 'msg-gemini-2',
        timestamp: new Date().toISOString(),
        type: 'gemini',
        model: MODEL_NAME,
        tokens: {
          input: MSG2_INPUT,
          output: MSG2_OUTPUT,
          cached: MSG2_CACHED,
          thoughts: MSG2_THOUGHTS,
          tool: MSG2_TOOL,
          total: MSG2_INPUT + MSG2_OUTPUT + MSG2_CACHED + MSG2_THOUGHTS + MSG2_TOOL,
        },
        content: 'Here is an explanation...',
      },
    ],
    kind: 'main',
  });
}

interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
}

interface ModelUsageSummary {
  model: string;
  modelFamily: string;
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
}

interface SessionTokenUsage {
  claudeSessionId: string;
  models: ModelUsageSummary[];
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
}

interface ModelBreakdownEntry {
  model: string;
  modelFamily: string;
  totals: TokenTotals;
  estimatedCostUsd: number;
  pctOfTotalCost: number;
}

describe('gemini token tracking', () => {
  const client = new McpTestClient();

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);

    // Write synthetic transcript for the scanner to discover
    await mkdir(TRANSCRIPT_DIR, { recursive: true });
    await writeFile(TRANSCRIPT_PATH, makeTranscript(), 'utf-8');

    // Trigger scan so all subsequent queries see the data
    await client.callToolText('tokens_refresh');
  });

  afterAll(async () => {
    // Clean up synthetic transcript file and parent dirs
    try {
      await rm(join(homedir(), '.gemini', 'tmp', PROJECT_DIR), { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
    await client.disconnect();
  });

  it('session usage returns correct token totals', async () => {
    const usage = await client.callToolJson<SessionTokenUsage>(
      'tokens_get_session_usage',
      { sessionId: GEMINI_SESSION_ID },
    );

    expect(usage.claudeSessionId).toBe(GEMINI_SESSION_ID);
    expect(usage.messageCount).toBe(2);
    expect(usage.totals.inputTokens).toBe(TOTAL_INPUT_UNCACHED);
    expect(usage.totals.outputTokens).toBe(TOTAL_OUTPUT);
    expect(usage.totals.cacheReadTokens).toBe(TOTAL_CACHE_READ);
    expect(usage.totals.cacheWrite5mTokens).toBe(0);
    expect(usage.totals.cacheWrite1hTokens).toBe(0);
    // Round-trip invariant: uncached + cached + writes should equal the full prompt tokens
    // originally reported by the Gemini API. This locks the storage convention so any
    // future regression (e.g. a new CLI storing raw input) will be caught here.
    expect(
      usage.totals.inputTokens +
        usage.totals.cacheReadTokens +
        usage.totals.cacheWrite5mTokens +
        usage.totals.cacheWrite1hTokens,
    ).toBe(TOTAL_RAW_PROMPT);
  });

  it('session usage includes correct model and family', async () => {
    const usage = await client.callToolJson<SessionTokenUsage>(
      'tokens_get_session_usage',
      { sessionId: GEMINI_SESSION_ID },
    );

    expect(usage.models).toHaveLength(1);
    const model = usage.models[0];
    // Parser normalizes model name before storing (strips -preview suffix)
    expect(model.model).toBe('gemini-3-flash');
    expect(model.modelFamily).toBe('gemini');
  });

  it('session usage has non-zero estimated cost', async () => {
    const usage = await client.callToolJson<SessionTokenUsage>(
      'tokens_get_session_usage',
      { sessionId: GEMINI_SESSION_ID },
    );

    // gemini-3-flash: input $0.50/MTok, output $3.00/MTok
    expect(usage.estimatedCostUsd).toBeGreaterThan(0);
    expect(usage.firstMessageAt).not.toBeNull();
    expect(usage.lastMessageAt).not.toBeNull();
  });

  it('model breakdown includes Gemini model', async () => {
    const breakdown = await client.callToolJson<ModelBreakdownEntry[]>(
      'tokens_get_model_breakdown',
      { days: 1 },
    );

    const geminiEntry = breakdown.find((e) => e.modelFamily === 'gemini');
    expect(geminiEntry).toBeDefined();
    expect(geminiEntry!.model).toBe('gemini-3-flash');
    expect(geminiEntry!.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('re-scan with updated transcript upserts token counts', async () => {
    // Get initial counts
    const before = await client.callToolJson<SessionTokenUsage>(
      'tokens_get_session_usage',
      { sessionId: GEMINI_SESSION_ID },
    );

    // Append a third gemini message to the transcript
    const transcript = JSON.parse(makeTranscript());
    transcript.messages.push({
      id: 'msg-gemini-3',
      timestamp: new Date().toISOString(),
      type: 'gemini',
      model: MODEL_NAME,
      tokens: { input: 1000, output: 100, cached: 0, thoughts: 50, tool: 0, total: 1150 },
      content: 'Third response',
    });
    await writeFile(TRANSCRIPT_PATH, JSON.stringify(transcript), 'utf-8');

    // Trigger re-scan
    await client.callToolText('tokens_refresh');

    const after = await client.callToolJson<SessionTokenUsage>(
      'tokens_get_session_usage',
      { sessionId: GEMINI_SESSION_ID },
    );

    expect(after.messageCount).toBe(before.messageCount + 1);
    expect(after.totals.inputTokens).toBe(before.totals.inputTokens + 1000);
    expect(after.totals.outputTokens).toBe(before.totals.outputTokens + 150); // 100 output + 50 thoughts
  });
});
