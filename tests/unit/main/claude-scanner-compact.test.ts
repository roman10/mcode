import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { fakeHome } = vi.hoisted(() => ({
  fakeHome: { value: '' },
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => fakeHome.value,
  };
});

import { ClaudeScanner } from '../../../src/main/trackers/claude-scanner';
import { InputTracker } from '../../../src/main/trackers/input-tracker';
import { getDb, resetDbForTest } from '../../../src/main/db';

const sessionId = 'bbbbbbbb-1111-2222-3333-555555555555';
const projectDirName = '-Users-test-mcode';

function fixtureWithCompact(): string {
  const lines = [
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-04-29T10:00:00Z',
      message: {
        model: 'claude-opus-4-7',
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 90_000 },
      },
    },
    {
      type: 'user',
      uuid: 'compact-1',
      timestamp: '2026-04-29T10:05:00Z',
      isCompactSummary: true,
      message: { content: 'Conversation compacted...' },
    },
  ];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

describe('ClaudeScanner — compact-marker integration', () => {
  let projectsDir: string;
  let inputTracker: InputTracker;
  let filePath: string;

  beforeAll(() => {
    fakeHome.value = join(tmpdir(), `claude-scan-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(fakeHome.value, { recursive: true });
    resetDbForTest();
  });

  afterAll(() => {
    rmSync(fakeHome.value, { recursive: true, force: true });
    resetDbForTest();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM token_usage').run();
    db.prepare('DELETE FROM tracked_jsonl_files').run();
    db.prepare('DELETE FROM sessions').run();

    projectsDir = join(fakeHome.value, '.claude', 'projects', projectDirName);
    mkdirSync(projectsDir, { recursive: true });
    filePath = join(projectsDir, `${sessionId}.jsonl`);

    db.prepare(`
      INSERT INTO sessions
        (session_id, label, cwd, status, started_at, session_type, claude_session_id)
      VALUES (?, ?, ?, 'active', ?, 'claude', ?)
    `).run(`tile-${sessionId}`, 'test', '/tmp', '2026-04-29T00:00:00Z', sessionId);

    inputTracker = new InputTracker();
  });

  it('stamps sessions.last_compact_at when scanning a transcript with a compact summary', async () => {
    writeFileSync(filePath, fixtureWithCompact());

    const scanner = new ClaudeScanner();
    await scanner.scanFile(filePath, inputTracker);

    const row = getDb().prepare(
      'SELECT last_compact_at FROM sessions WHERE claude_session_id = ?',
    ).get(sessionId) as { last_compact_at: string | null };
    expect(row.last_compact_at).toBe('2026-04-29T10:05:00Z');
  });

  it('does not regress last_compact_at when re-scanning an older marker', async () => {
    const db = getDb();
    db.prepare('UPDATE sessions SET last_compact_at = ? WHERE claude_session_id = ?')
      .run('2026-04-29T11:00:00Z', sessionId);

    writeFileSync(filePath, fixtureWithCompact());
    await new ClaudeScanner().scanFile(filePath, inputTracker);

    const row = db.prepare(
      'SELECT last_compact_at FROM sessions WHERE claude_session_id = ?',
    ).get(sessionId) as { last_compact_at: string | null };
    expect(row.last_compact_at).toBe('2026-04-29T11:00:00Z');
  });

  it('leaves last_compact_at null for transcripts without a compact summary', async () => {
    const lines = [
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-04-29T10:00:00Z',
        message: {
          model: 'claude-opus-4-7',
          usage: { input_tokens: 1000, output_tokens: 200 },
        },
      },
    ];
    writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

    await new ClaudeScanner().scanFile(filePath, inputTracker);

    const row = getDb().prepare(
      'SELECT last_compact_at FROM sessions WHERE claude_session_id = ?',
    ).get(sessionId) as { last_compact_at: string | null };
    expect(row.last_compact_at).toBeNull();
  });
});
