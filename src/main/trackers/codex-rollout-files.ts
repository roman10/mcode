/**
 * Shared traversal of Codex CLI rollout transcript files.
 *
 * Codex stores one rollout JSONL per session at
 *   <codexHome>/sessions/YYYY/MM/DD/rollout-<timestamp>-<threadId>.jsonl
 *
 * Three consumers walk this tree — the usage scanner, the quota provider, and
 * the fork/handoff transcript reader — so the directory walk lives here once.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** readdir that yields [] for missing/unreadable dirs instead of throwing. */
export async function safeReadDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** Yield absolute paths of every `rollout-*.jsonl` under `<sessionsDir>/YYYY/MM/DD`.
 *  With `newestFirst`, year/month/day dirs are walked in descending name order so
 *  callers that want the latest rollout can stop at the first match. */
export async function* iterateCodexRolloutFiles(
  sessionsDir: string,
  opts: { newestFirst?: boolean } = {},
): AsyncGenerator<string> {
  const order = (xs: string[]): string[] =>
    opts.newestFirst ? [...xs].sort().reverse() : [...xs].sort();

  for (const year of order(await safeReadDir(sessionsDir))) {
    const yearPath = join(sessionsDir, year);
    for (const month of order(await safeReadDir(yearPath))) {
      const monthPath = join(yearPath, month);
      for (const day of order(await safeReadDir(monthPath))) {
        const dayPath = join(monthPath, day);
        for (const file of order(await safeReadDir(dayPath))) {
          if (file.startsWith('rollout-') && file.endsWith('.jsonl')) {
            yield join(dayPath, file);
          }
        }
      }
    }
  }
}
