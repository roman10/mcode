import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TokenTracker } from '../../../src/main/trackers/token-tracker';
import { InputTracker } from '../../../src/main/trackers/input-tracker';
import type { AccountService } from '../../../src/main/accounts';
import { getDb, resetDbForTest } from '../../../src/main/db';

const sessionId = 'aaaaaaaa-1111-2222-3333-444444444444';
const projectDir = '-Users-test-mcode';

function makeTracker(): TokenTracker {
  const stubAccount = {
    listAllAccountPaths: () => [],
  } as unknown as AccountService;
  return new TokenTracker(() => null, new InputTracker(), stubAccount);
}

function insertTokenRow(opts: {
  messageId: string;
  model?: string;
  inputTokens: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  cacheRead?: number;
  outputTokens?: number;
  timestamp: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO token_usage
      (message_id, agent_session_id, project_dir, model,
       input_tokens, output_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
       cache_read_tokens, is_fast_mode, message_timestamp, date, provider)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'claude')
  `).run(
    opts.messageId,
    sessionId,
    projectDir,
    opts.model ?? 'claude-opus-4-7',
    opts.inputTokens,
    opts.outputTokens ?? 100,
    opts.cacheWrite5m ?? 0,
    opts.cacheWrite1h ?? 0,
    opts.cacheRead ?? 0,
    opts.timestamp,
    opts.timestamp.slice(0, 10),
  );
}

function ensureSession(claudeSessionId: string): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO sessions
      (session_id, label, cwd, status, started_at, session_type, claude_session_id)
    VALUES (?, ?, ?, 'active', ?, 'claude', ?)
  `).run(`tile-${claudeSessionId}`, 'test', '/tmp', '2026-04-29T00:00:00Z', claudeSessionId);
}

describe('TokenTracker.getSessionUsage — currentContext', () => {
  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM token_usage').run();
    db.prepare('DELETE FROM sessions').run();
  });

  it('returns null when session has no token rows', () => {
    const usage = makeTracker().getSessionUsage(sessionId);
    expect(usage.currentContext).toBeNull();
  });

  it('computes used = input + cache writes + cache read of latest message', () => {
    insertTokenRow({
      messageId: 'm1',
      model: 'claude-sonnet-4-6',
      timestamp: '2026-04-29T10:00:00Z',
      inputTokens: 1_000,
      cacheRead: 80_000,
      cacheWrite5m: 5_000,
      cacheWrite1h: 2_000,
    });
    insertTokenRow({
      messageId: 'm2',
      model: 'claude-sonnet-4-6',
      timestamp: '2026-04-29T10:05:00Z',
      inputTokens: 2_000,
      cacheRead: 90_000,
      cacheWrite5m: 0,
      cacheWrite1h: 1_000,
    });

    const usage = makeTracker().getSessionUsage(sessionId);
    expect(usage.currentContext).toEqual({
      model: 'claude-sonnet-4-6',
      usedTokens: 2_000 + 0 + 1_000 + 90_000, // latest only
      contextWindow: 200_000,
      percent: Math.round((93_000 / 200_000) * 100),
    });
  });

  it('uses 1M window for opus-4.7 by default (native 1M tier)', () => {
    insertTokenRow({
      messageId: 'm1',
      model: 'claude-opus-4-7',
      timestamp: '2026-04-29T10:00:00Z',
      inputTokens: 5_000,
      cacheRead: 250_000,
    });

    const usage = makeTracker().getSessionUsage(sessionId);
    expect(usage.currentContext?.contextWindow).toBe(1_000_000);
    expect(usage.currentContext?.percent).toBe(26);
  });

  it('uses 1M window when raw model id has [1m] suffix', () => {
    insertTokenRow({
      messageId: 'm1',
      model: 'claude-opus-4-7[1m]',
      timestamp: '2026-04-29T10:00:00Z',
      inputTokens: 5_000,
      cacheRead: 250_000,
    });

    const usage = makeTracker().getSessionUsage(sessionId);
    expect(usage.currentContext?.contextWindow).toBe(1_000_000);
    expect(usage.currentContext?.percent).toBe(26); // 255_000 / 1_000_000 -> 26%
  });

  it('returns percent=null and contextWindow=null for unknown model', () => {
    insertTokenRow({
      messageId: 'm1',
      model: 'claude-future-99',
      timestamp: '2026-04-29T10:00:00Z',
      inputTokens: 1_000,
    });

    const usage = makeTracker().getSessionUsage(sessionId);
    expect(usage.currentContext?.contextWindow).toBeNull();
    expect(usage.currentContext?.percent).toBeNull();
    expect(usage.currentContext?.usedTokens).toBe(1_000);
  });

  it('suppresses currentContext when last_compact_at is newer than latest message', () => {
    ensureSession(sessionId);
    insertTokenRow({
      messageId: 'm1',
      timestamp: '2026-04-29T10:00:00Z',
      inputTokens: 100_000,
    });
    getDb().prepare(
      'UPDATE sessions SET last_compact_at = ? WHERE claude_session_id = ?',
    ).run('2026-04-29T10:05:00Z', sessionId);

    const usage = makeTracker().getSessionUsage(sessionId);
    expect(usage.currentContext).toBeNull();
  });

  it('keeps currentContext when last_compact_at is older than latest message', () => {
    ensureSession(sessionId);
    insertTokenRow({
      messageId: 'm1',
      timestamp: '2026-04-29T10:10:00Z',
      inputTokens: 50_000,
    });
    getDb().prepare(
      'UPDATE sessions SET last_compact_at = ? WHERE claude_session_id = ?',
    ).run('2026-04-29T10:05:00Z', sessionId);

    const usage = makeTracker().getSessionUsage(sessionId);
    expect(usage.currentContext?.usedTokens).toBe(50_000);
  });
});
