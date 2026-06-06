import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readClaudeTranscript,
  readCodexTranscript,
  readSessionTranscript,
} from '../../../src/main/session/transcript-reader';

/**
 * readClaudeTranscript reads files from `<homedir>/.claude/projects/<encoded-cwd>/<id>.jsonl`.
 * `os.homedir()` reads HOME at call time, so overriding it routes the lookup
 * into a sandbox dir we own.
 */

describe('transcript-reader', () => {
  let sandbox: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'mcode-transcript-'));
    originalHome = process.env.HOME;
    process.env.HOME = sandbox;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(sandbox, { recursive: true, force: true });
  });

  async function writeJsonl(cwd: string, sessionId: string, lines: object[]): Promise<void> {
    const encoded = cwd.replace(/\//g, '-');
    const dir = join(sandbox, '.claude', 'projects', encoded);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${sessionId}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }

  it('returns empty string when transcript file is missing', async () => {
    const result = await readClaudeTranscript('/Users/example/proj', 'missing-id');
    expect(result).toBe('');
  });

  it('flattens user and assistant turns with role prefixes', async () => {
    const cwd = '/Users/example/proj';
    await writeJsonl(cwd, 'sess1', [
      { type: 'user', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'follow-up' }] } },
    ]);

    const out = await readClaudeTranscript(cwd, 'sess1');
    expect(out).toBe('User: hello\n\nAssistant: hi\n\nUser: follow-up');
  });

  it('skips tool-use blocks and other non-message lines', async () => {
    const cwd = '/Users/example/proj';
    await writeJsonl(cwd, 'sess2', [
      { type: 'user', message: { role: 'user', content: 'prompt' } },
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'tool_use', id: 'x', name: 'Read', input: {} },
        { type: 'text', text: 'reply' },
      ] } },
      { type: 'system', subtype: 'init' },
    ]);

    const out = await readClaudeTranscript(cwd, 'sess2');
    expect(out).toContain('User: prompt');
    expect(out).toContain('Assistant: reply');
    expect(out).not.toContain('tool_use');
    expect(out).not.toContain('init');
  });

  async function writeCodexRollout(
    sessionsDir: string,
    ymd: [string, string, string],
    threadId: string,
    lines: object[],
  ): Promise<void> {
    const dir = join(sessionsDir, ...ymd);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `rollout-2026-06-06T11-18-44-${threadId}.jsonl`);
    await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }

  it('reads codex rollout from disk, keeping user/agent turns', async () => {
    const sessionsDir = join(sandbox, '.codex', 'sessions');
    const threadId = '019e9af0-aa5d-7b53-85d2-f2b3f134d961';
    await writeCodexRollout(sessionsDir, ['2026', '06', '06'], threadId, [
      { type: 'session_meta', payload: { id: threadId, cwd: '/tmp/proj' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'do the thing' } },
      { type: 'response_item', payload: { type: 'reasoning', content: 'thinking…' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'done' } },
      { type: 'event_msg', payload: { type: 'token_count', info: null } },
    ]);

    const out = await readCodexTranscript(sessionsDir, threadId);
    expect(out).toBe('User: do the thing\n\nAssistant: done');
  });

  it('returns empty string when no codex rollout matches the thread id', async () => {
    const sessionsDir = join(sandbox, '.codex', 'sessions');
    expect(await readCodexTranscript(sessionsDir, 'no-such-thread')).toBe('');
  });

  it('prefers codex on-disk rollout over PTY scrollback in readSessionTranscript', async () => {
    const sessionsDir = join(sandbox, '.codex', 'sessions');
    const threadId = 'aaaa1111-bbbb-2222-cccc-333344445555';
    await writeCodexRollout(sessionsDir, ['2026', '06', '06'], threadId, [
      { type: 'session_meta', payload: { id: threadId, cwd: '/tmp/proj' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'resumed prompt' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'resumed reply' } },
    ]);

    const out = await readSessionTranscript({
      sessionType: 'codex',
      cwd: '/tmp/proj',
      claudeSessionId: null,
      codexThreadId: threadId,
      codexSessionsDir: sessionsDir,
      ptyReplayBuffer: 'stale scrollback that should be ignored',
    });
    expect(out).toBe('User: resumed prompt\n\nAssistant: resumed reply');
  });

  it('falls back to PTY scrollback when codex rollout is missing', async () => {
    const out = await readSessionTranscript({
      sessionType: 'codex',
      cwd: '/tmp/proj',
      claudeSessionId: null,
      codexThreadId: 'missing-thread',
      codexSessionsDir: join(sandbox, '.codex', 'sessions'),
      ptyReplayBuffer: 'live buffer fallback',
    });
    expect(out).toBe('live buffer fallback');
  });

  it('strips ANSI from PTY replay buffers when source is non-Claude', async () => {
    const buffer = '\x1b[1;32mHello\x1b[0m world\x1b[2J';
    const out = await readSessionTranscript({
      sessionType: 'codex',
      cwd: '/tmp',
      claudeSessionId: null,
      ptyReplayBuffer: buffer,
    });
    expect(out).toBe('Hello world');
  });

  it('returns empty string for non-Claude source with no PTY buffer', async () => {
    const out = await readSessionTranscript({
      sessionType: 'gemini',
      cwd: '/tmp',
      claudeSessionId: null,
    });
    expect(out).toBe('');
  });
});
