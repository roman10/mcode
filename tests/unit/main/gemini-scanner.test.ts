import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
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

  // Gemini CLI flipped from `.json` (single doc) to `.jsonl` (line-delimited)
  // around 2026-04-22. The scanner must accept both extensions and route
  // sessionId derivation through the JSONL header line.
  function makeTranscriptJsonl(opts: {
    sessionId: string;
    timestamp: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }): string {
    return [
      JSON.stringify({ sessionId: opts.sessionId, projectHash: 'h', startTime: opts.timestamp, lastUpdated: opts.timestamp, kind: 'main' }),
      JSON.stringify({ id: 'u1', timestamp: opts.timestamp, type: 'user', content: [{ text: 'hi' }] }),
      JSON.stringify({ $set: { lastUpdated: opts.timestamp } }),
      JSON.stringify({
        id: 'g1', timestamp: opts.timestamp, type: 'gemini', content: 'ok',
        tokens: { input: opts.inputTokens, output: opts.outputTokens, cached: 0, thoughts: 0, tool: 0, total: opts.inputTokens + opts.outputTokens },
        model: opts.model,
      }),
      '',
    ].join('\n');
  }

  function seedJsonlAccount(accountName: string, sessionId: string, tokens: number): string {
    const tmp = join(root, accountName, '.gemini', 'tmp');
    const chatsDir = join(tmp, `project-${accountName}`, 'chats');
    mkdirSync(chatsDir, { recursive: true });
    writeFileSync(
      join(chatsDir, `session-${sessionId}.jsonl`),
      makeTranscriptJsonl({
        sessionId,
        timestamp: '2026-04-27T23:00:00.000Z',
        model: 'gemini-3-flash-preview',
        inputTokens: tokens,
        outputTokens: tokens,
      }),
    );
    return tmp;
  }

  it('scans .jsonl transcripts and stores the sessionId from the header line', async () => {
    const dir = seedJsonlAccount('default', 'jsonl-aaaa', 4242);
    const scanner = new GeminiScanner(() => [dir]);

    const count = await scanner.scanAll(inputTracker);
    expect(count).toBe(1);

    const row = getDb().prepare(
      `SELECT agent_session_id, input_tokens, model FROM token_usage WHERE provider='gemini'`,
    ).get() as { agent_session_id: string; input_tokens: number; model: string };

    expect(row.input_tokens).toBe(4242);
    expect(row.model).toBe('gemini-3-flash');                 // -preview suffix stripped
    expect(row.agent_session_id).toBe('jsonl-aaaa');           // pulled from header, NOT filename
  });

  it('handles legacy .json and new .jsonl in the same chats directory', async () => {
    const tmp = join(root, 'mixed', '.gemini', 'tmp');
    const chatsDir = join(tmp, 'project-mixed', 'chats');
    mkdirSync(chatsDir, { recursive: true });
    writeFileSync(
      join(chatsDir, 'session-legacy.json'),
      makeTranscriptJson({
        sessionId: 'legacy', timestamp: '2026-04-20T00:00:00Z',
        model: 'gemini-2.5-pro', inputTokens: 100, outputTokens: 100,
      }),
    );
    writeFileSync(
      join(chatsDir, 'session-new.jsonl'),
      makeTranscriptJsonl({
        sessionId: 'new', timestamp: '2026-04-27T23:00:00Z',
        model: 'gemini-3-flash-preview', inputTokens: 200, outputTokens: 200,
      }),
    );

    const scanner = new GeminiScanner(() => [tmp]);
    expect(await scanner.scanAll(inputTracker)).toBe(2);

    const ids = (getDb().prepare(
      `SELECT agent_session_id FROM token_usage WHERE provider='gemini' ORDER BY agent_session_id`,
    ).all() as Array<{ agent_session_id: string }>).map((r) => r.agent_session_id);
    expect(ids).toEqual(['legacy', 'new']);
  });

  it('re-scans .jsonl files whose stale watermark was cleared by migration', async () => {
    const dir = seedJsonlAccount('default', 'jsonl-stale', 9999);
    const filePath = join(dir, 'project-default', 'chats', 'session-jsonl-stale.jsonl');
    const fileSize = statSync(filePath).size;
    const scanner = new GeminiScanner(() => [dir]);

    // Reproduce the pre-fix state: an earlier (broken) scan inserted a watermark
    // at file_size but produced zero token rows because the parser failed silently
    // on JSONL. The new scanner would still short-circuit on `fileSize <= lastOffset`.
    getDb().prepare(`
      INSERT INTO tracked_jsonl_files (file_path, agent_session_id, project_dir, last_scanned_offset, file_size, last_scanned_at, provider)
      VALUES (?, 'session-jsonl-stale.jsonl', 'project-default', ?, ?, datetime('now'), 'gemini')
    `).run(filePath, fileSize, fileSize);
    expect(await scanner.scanAll(inputTracker)).toBe(0); // blocked by stale watermark

    // Migration `045_reset_gemini_jsonl_watermarks.sql` clears these rows.
    getDb().prepare(
      `DELETE FROM tracked_jsonl_files WHERE provider = 'gemini' AND file_path LIKE '%.jsonl'`,
    ).run();

    expect(await scanner.scanAll(inputTracker)).toBe(1); // now ingests
    const wm = getDb().prepare(
      `SELECT agent_session_id FROM tracked_jsonl_files WHERE provider='gemini'`,
    ).get() as { agent_session_id: string };
    expect(wm.agent_session_id).toBe('jsonl-stale'); // not the filename — proves header parsed
  });
});
