import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CopilotScanner } from '../../../src/main/trackers/copilot-scanner';
import { InputTracker } from '../../../src/main/trackers/input-tracker';
import { getDb, resetDbForTest } from '../../../src/main/db';

function makeShutdownJsonl(opts: {
  cwd: string;
  timestamp: string;
  modelMetrics: Record<string, { input: number; output: number; cacheRead: number }>;
}): string {
  const start = JSON.stringify({
    type: 'session.start',
    data: { context: { cwd: opts.cwd } },
    id: 'start-1',
    timestamp: opts.timestamp,
  });
  const modelMetrics = Object.fromEntries(
    Object.entries(opts.modelMetrics).map(([model, m]) => [
      model,
      {
        requests: { count: 1, cost: 1 },
        usage: { inputTokens: m.input, outputTokens: m.output, cacheReadTokens: m.cacheRead, cacheWriteTokens: 0 },
      },
    ]),
  );
  const shutdown = JSON.stringify({
    type: 'session.shutdown',
    data: { totalPremiumRequests: 1, modelMetrics },
    id: 'shutdown-1',
    timestamp: opts.timestamp,
  });
  return `${start}\n${shutdown}\n`;
}

function uuid(prefix: string): string {
  // UUID-shaped id (scanner uses regex to filter session dirnames)
  const h = prefix.padEnd(8, '0').slice(0, 8);
  return `${h}-0000-4000-8000-000000000000`;
}

describe('CopilotScanner — account enumeration', () => {
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
    root = join(tmpdir(), `copilot-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    inputTracker = new InputTracker();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function seedAccount(accountName: string, sessionId: string, model: string, tokens = 1000): string {
    const stateDir = join(root, accountName, '.copilot', 'session-state');
    const sessionDir = join(stateDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'events.jsonl'),
      makeShutdownJsonl({
        cwd: `/fake/${accountName}`,
        timestamp: '2026-04-22T00:00:00.000Z',
        modelMetrics: { [model]: { input: tokens, output: tokens, cacheRead: 0 } },
      }),
    );
    return stateDir;
  }

  it('scans every account dir returned by the resolver', async () => {
    const dirA = seedAccount('default', uuid('aaaaaaaa'), 'gpt-5.4');
    const dirB = seedAccount('work', uuid('bbbbbbbb'), 'gpt-5.4', 2500);
    const scanner = new CopilotScanner(() => [dirA, dirB]);

    const count = await scanner.scanAll(inputTracker);
    expect(count).toBe(2);

    const rows = getDb().prepare(
      `SELECT agent_session_id, input_tokens FROM token_usage WHERE provider='copilot' ORDER BY input_tokens`,
    ).all() as Array<{ agent_session_id: string; input_tokens: number }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].input_tokens).toBe(1000);
    expect(rows[1].input_tokens).toBe(2500);
  });

  it('silently skips missing account dirs', async () => {
    const dirA = seedAccount('default', uuid('cccccccc'), 'gpt-5.4');
    const missing = join(root, 'never-created', '.copilot', 'session-state');
    const scanner = new CopilotScanner(() => [dirA, missing]);

    const count = await scanner.scanAll(inputTracker);
    expect(count).toBe(1);
  });

  it('watermarks each account dir independently', async () => {
    const dirA = seedAccount('default', uuid('dddddddd'), 'gpt-5.4');
    const dirB = seedAccount('work', uuid('eeeeeeee'), 'gpt-5.4');
    const scanner = new CopilotScanner(() => [dirA, dirB]);

    await scanner.scanAll(inputTracker);

    const watermarks = getDb().prepare(
      `SELECT file_path FROM tracked_jsonl_files WHERE provider='copilot' ORDER BY file_path`,
    ).all() as Array<{ file_path: string }>;
    expect(watermarks).toHaveLength(2);
    expect(watermarks.some((w) => w.file_path.includes('/default/'))).toBe(true);
    expect(watermarks.some((w) => w.file_path.includes('/work/'))).toBe(true);
  });

  it('returns 0 when the resolver returns an empty list', async () => {
    const scanner = new CopilotScanner(() => []);
    const count = await scanner.scanAll(inputTracker);
    expect(count).toBe(0);
  });
});
