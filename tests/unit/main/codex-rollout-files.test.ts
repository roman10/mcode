import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iterateCodexRolloutFiles } from '../../../src/main/trackers/codex-rollout-files';

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

describe('iterateCodexRolloutFiles', () => {
  let sessionsDir: string;

  beforeEach(async () => {
    sessionsDir = await mkdtemp(join(tmpdir(), 'mcode-codex-sessions-'));
  });

  afterEach(async () => {
    await rm(sessionsDir, { recursive: true, force: true });
  });

  async function touch(ymd: [string, string, string], file: string): Promise<void> {
    const dir = join(sessionsDir, ...ymd);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, file), '');
  }

  it('yields only rollout-*.jsonl files, skipping other entries', async () => {
    await touch(['2026', '06', '06'], 'rollout-2026-06-06T11-00-00-aaa.jsonl');
    await touch(['2026', '06', '06'], 'notes.txt');
    await touch(['2026', '06', '06'], 'rollout-broken.json'); // wrong extension

    const files = await collect(iterateCodexRolloutFiles(sessionsDir));
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('rollout-2026-06-06T11-00-00-aaa.jsonl');
  });

  it('returns empty for a missing sessions dir', async () => {
    const files = await collect(iterateCodexRolloutFiles(join(sessionsDir, 'does-not-exist')));
    expect(files).toEqual([]);
  });

  it('walks newest-first across days when requested', async () => {
    await touch(['2026', '06', '05'], 'rollout-2026-06-05T09-00-00-older.jsonl');
    await touch(['2026', '06', '07'], 'rollout-2026-06-07T09-00-00-newer.jsonl');

    const newestFirst = await collect(iterateCodexRolloutFiles(sessionsDir, { newestFirst: true }));
    expect(newestFirst[0]).toContain('newer');
    expect(newestFirst[1]).toContain('older');

    const oldestFirst = await collect(iterateCodexRolloutFiles(sessionsDir));
    expect(oldestFirst[0]).toContain('older');
    expect(oldestFirst[1]).toContain('newer');
  });
});
