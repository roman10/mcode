import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeTranscriptRefresher } from '../../../src/main/session/claude-transcript-refresher';

/** Real timers throughout — schedule() uses small delays and fake timers don't
 *  interact cleanly with the real fs.stat inside the refresher. */
describe('ClaudeTranscriptRefresher', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcode-refresher-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('coalesces a burst of schedule() calls into a single refresh', async () => {
    const transcriptPath = join(tempDir, 'claude.jsonl');
    await writeFile(transcriptPath, 'first\n');
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const refresher = new ClaudeTranscriptRefresher(onChanged);

    refresher.schedule('s1', transcriptPath, 0);
    refresher.schedule('s1', transcriptPath, 0);
    refresher.schedule('s1', transcriptPath, 0);

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(onChanged).toHaveBeenCalledWith('s1', transcriptPath);
  });

  it('skips the re-read when a second schedule arrives mid-flight with an unchanged file', async () => {
    const transcriptPath = join(tempDir, 'claude.jsonl');
    await writeFile(transcriptPath, 'first\n');
    let releaseFirst: () => void;
    const firstInFlight = new Promise<void>((r) => { releaseFirst = r; });
    let calls = 0;
    const onChanged = vi.fn(async () => {
      calls++;
      if (calls === 1) await firstInFlight;
    });
    const refresher = new ClaudeTranscriptRefresher(onChanged);

    refresher.schedule('s1', transcriptPath, 0);
    // Wait until the first refresh is actually in flight.
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    // While the first refresh is awaiting its in-flight promise, queue another.
    refresher.schedule('s1', transcriptPath, 0);
    // Give the queued timer a tick to land in queuedTranscriptPath.
    await new Promise((r) => setTimeout(r, 10));

    // Release the first refresh; its finally() runs the queued flush, which
    // sees the same `path:size:mtime` and short-circuits before onChanged.
    releaseFirst!();
    await new Promise((r) => setTimeout(r, 20));

    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('re-reads when the file mtime has changed between schedules in one burst', async () => {
    const transcriptPath = join(tempDir, 'claude.jsonl');
    await writeFile(transcriptPath, 'first\n');
    let releaseFirst: () => void;
    const firstInFlight = new Promise<void>((r) => { releaseFirst = r; });
    let calls = 0;
    const onChanged = vi.fn(async () => {
      calls++;
      if (calls === 1) await firstInFlight;
    });
    const refresher = new ClaudeTranscriptRefresher(onChanged);

    refresher.schedule('s1', transcriptPath, 0);
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

    // Bump the file mtime far enough that the second freshness key differs.
    const future = new Date(Date.now() + 60_000);
    await utimes(transcriptPath, future, future);
    refresher.schedule('s1', transcriptPath, 0);
    await new Promise((r) => setTimeout(r, 10));

    releaseFirst!();
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  });

  it('shutdown() clears any pending timer', async () => {
    const transcriptPath = join(tempDir, 'claude.jsonl');
    await writeFile(transcriptPath, 'first\n');
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const refresher = new ClaudeTranscriptRefresher(onChanged);

    refresher.schedule('s1', transcriptPath, 60_000);
    refresher.shutdown();

    await new Promise((r) => setTimeout(r, 50));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
