import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeTranscript, readSessionTranscript } from '../../../src/main/session/transcript-reader';

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
