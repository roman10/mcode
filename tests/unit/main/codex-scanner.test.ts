import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexScanner } from '../../../src/main/trackers/codex-scanner';
import { InputTracker } from '../../../src/main/trackers/input-tracker';
import { getDb, resetDbForTest } from '../../../src/main/db';

function makeTranscriptJsonl(opts: {
  sessionId: string;
  cwd: string;
  model: string;
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
}): string {
  const sessionMeta = JSON.stringify({
    type: 'session_meta',
    payload: { id: opts.sessionId, cwd: opts.cwd },
  });
  const turnContext = JSON.stringify({
    type: 'turn_context',
    payload: { model: opts.model },
  });
  const tokenCount = JSON.stringify({
    type: 'event_msg',
    timestamp: opts.timestamp,
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: opts.inputTokens,
          cached_input_tokens: 0,
          output_tokens: opts.outputTokens,
          reasoning_output_tokens: 0,
          total_tokens: opts.inputTokens + opts.outputTokens,
        },
      },
    },
  });
  return `${sessionMeta}\n${turnContext}\n${tokenCount}\n`;
}

describe('CodexScanner — account enumeration', () => {
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
    root = join(tmpdir(), `codex-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    inputTracker = new InputTracker();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function seedAccount(accountName: string, sessionId: string, tokens: number): string {
    const sessionsDir = join(root, accountName, '.codex', 'sessions');
    const fileDir = join(sessionsDir, '2026', '04', '22');
    mkdirSync(fileDir, { recursive: true });
    writeFileSync(
      join(fileDir, `rollout-${sessionId}.jsonl`),
      makeTranscriptJsonl({
        sessionId,
        cwd: `/fake/${accountName}`,
        model: 'gpt-5.4-codex',
        timestamp: '2026-04-22T00:00:00.000Z',
        inputTokens: tokens,
        outputTokens: tokens,
      }),
    );
    return sessionsDir;
  }

  it('scans every account dir returned by the resolver', async () => {
    const dirA = seedAccount('default', 'codex-session-aaaa', 1000);
    const dirB = seedAccount('work', 'codex-session-bbbb', 2500);
    const scanner = new CodexScanner(() => [dirA, dirB]);

    const count = await scanner.scanAll(inputTracker);
    expect(count).toBe(2);

    const rows = getDb().prepare(
      `SELECT agent_session_id, input_tokens FROM token_usage WHERE provider='codex' ORDER BY input_tokens`,
    ).all() as Array<{ agent_session_id: string; input_tokens: number }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.input_tokens)).toEqual([1000, 2500]);
  });

  it('watermarks each account dir independently', async () => {
    const dirA = seedAccount('default', 'codex-session-cccc', 1000);
    const dirB = seedAccount('work', 'codex-session-dddd', 1000);
    const scanner = new CodexScanner(() => [dirA, dirB]);

    await scanner.scanAll(inputTracker);

    const watermarks = getDb().prepare(
      `SELECT file_path FROM tracked_jsonl_files WHERE provider='codex' ORDER BY file_path`,
    ).all() as Array<{ file_path: string }>;
    expect(watermarks).toHaveLength(2);
    expect(watermarks.some((w) => w.file_path.includes('/default/'))).toBe(true);
    expect(watermarks.some((w) => w.file_path.includes('/work/'))).toBe(true);
  });

  it('silently skips missing account dirs', async () => {
    const dirA = seedAccount('default', 'codex-session-eeee', 1000);
    const missing = join(root, 'never-created', '.codex', 'sessions');
    const scanner = new CodexScanner(() => [dirA, missing]);

    const count = await scanner.scanAll(inputTracker);
    expect(count).toBe(1);
  });
});
