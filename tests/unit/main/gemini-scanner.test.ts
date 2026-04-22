import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GeminiScanner } from '../../../src/main/trackers/gemini-scanner';
import { InputTracker } from '../../../src/main/trackers/input-tracker';
import { getDb, resetDbForTest } from '../../../src/main/db';

function makeTranscriptJson(opts: {
  sessionId: string;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): string {
  return JSON.stringify({
    sessionId: opts.sessionId,
    messages: [
      {
        id: 'msg-1',
        timestamp: opts.timestamp,
        type: 'gemini',
        model: opts.model,
        tokens: {
          input: opts.inputTokens,
          output: opts.outputTokens,
          cached: 0,
          thoughts: 0,
          tool: 0,
          total: opts.inputTokens + opts.outputTokens,
        },
      },
    ],
  });
}

describe('GeminiScanner — account enumeration', () => {
  let root: string;
  let inputTracker: InputTracker;

  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    getDb().prepare('DELETE FROM token_usage').run();
    getDb().prepare('DELETE FROM tracked_jsonl_files').run();
    root = join(tmpdir(), `gemini-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    inputTracker = new InputTracker();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function seedAccount(accountName: string, sessionId: string, tokens: number): string {
    const tmp = join(root, accountName, '.gemini', 'tmp');
    const chatsDir = join(tmp, `project-${accountName}`, 'chats');
    mkdirSync(chatsDir, { recursive: true });
    writeFileSync(
      join(chatsDir, `session-${sessionId}.json`),
      makeTranscriptJson({
        sessionId,
        timestamp: '2026-04-22T00:00:00.000Z',
        model: 'gemini-2.5-pro',
        inputTokens: tokens,
        outputTokens: tokens,
      }),
    );
    return tmp;
  }

  it('scans every account dir returned by the resolver', async () => {
    const dirA = seedAccount('default', 'gem-aaaa', 1000);
    const dirB = seedAccount('work', 'gem-bbbb', 2500);
    const scanner = new GeminiScanner(() => [dirA, dirB]);

    const count = await scanner.scanAll(inputTracker);
    expect(count).toBe(2);

    const rows = getDb().prepare(
      `SELECT agent_session_id, input_tokens FROM token_usage WHERE provider='gemini' ORDER BY input_tokens`,
    ).all() as Array<{ agent_session_id: string; input_tokens: number }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.input_tokens)).toEqual([1000, 2500]);
  });

  it('watermarks each account dir independently', async () => {
    const dirA = seedAccount('default', 'gem-cccc', 1000);
    const dirB = seedAccount('work', 'gem-dddd', 1000);
    const scanner = new GeminiScanner(() => [dirA, dirB]);

    await scanner.scanAll(inputTracker);

    const watermarks = getDb().prepare(
      `SELECT file_path FROM tracked_jsonl_files WHERE provider='gemini' ORDER BY file_path`,
    ).all() as Array<{ file_path: string }>;
    expect(watermarks).toHaveLength(2);
    expect(watermarks.some((w) => w.file_path.includes('/default/'))).toBe(true);
    expect(watermarks.some((w) => w.file_path.includes('/work/'))).toBe(true);
  });

  it('silently skips missing account dirs', async () => {
    const dirA = seedAccount('default', 'gem-eeee', 1000);
    const missing = join(root, 'never-created', '.gemini', 'tmp');
    const scanner = new GeminiScanner(() => [dirA, missing]);

    const count = await scanner.scanAll(inputTracker);
    expect(count).toBe(1);
  });
});
