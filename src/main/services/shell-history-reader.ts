import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { ShellHistoryEntry } from '../../shared/types';

interface Cache {
  path: string;
  mtimeMs: number;
  entries: ShellHistoryEntry[];
}

let cache: Cache | null = null;

function resolveHistFile(): string | null {
  const envHistFile = process.env.HISTFILE;
  if (envHistFile && envHistFile.trim().length > 0) {
    return envHistFile;
  }
  const shell = basename(process.env.SHELL ?? '/bin/zsh');
  if (shell === 'zsh') return join(homedir(), '.zsh_history');
  if (shell === 'bash') return join(homedir(), '.bash_history');
  return null;
}

// zsh extended format:
//   : <epoch>:<duration>;<command>
// multi-line commands end each intermediate line with a trailing `\` and
// embed the real newline as `\n` inside the final text. When HIST_SAVE_NO_DUPS
// is off, consecutive duplicates may repeat.
export function parseShellHistory(text: string): ShellHistoryEntry[] {
  const out: ShellHistoryEntry[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    i += 1;
    if (line === undefined) continue;

    // Stitch back multi-line entries: zsh joins with `\` at end of the line.
    while (line.endsWith('\\') && i < lines.length) {
      line = line.slice(0, -1) + '\n' + lines[i];
      i += 1;
    }

    if (line.length === 0) continue;

    const extMatch = /^: (\d+):\d+;(.*)$/s.exec(line);
    if (extMatch) {
      const ts = Number(extMatch[1]);
      const cmd = extMatch[2].trim();
      if (cmd.length > 0) {
        out.push({ command: cmd, ts: Number.isFinite(ts) ? ts : null });
      }
      continue;
    }

    // bash plain format (or a timestamp comment line `#1234567890`).
    if (line.startsWith('#')) {
      const tsMatch = /^#(\d+)$/.exec(line);
      if (tsMatch && i < lines.length) {
        const ts = Number(tsMatch[1]);
        const cmd = lines[i]?.trim() ?? '';
        if (cmd.length > 0) {
          out.push({ command: cmd, ts: Number.isFinite(ts) ? ts : null });
          i += 1;
        }
      }
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.length > 0) {
      out.push({ command: trimmed, ts: null });
    }
  }
  return out;
}

async function loadHistFile(path: string): Promise<ShellHistoryEntry[]> {
  try {
    const st = await stat(path);
    if (cache && cache.path === path && cache.mtimeMs === st.mtimeMs) {
      return cache.entries;
    }
    const text = await readFile(path, 'utf8');
    const entries = parseShellHistory(text);
    cache = { path, mtimeMs: st.mtimeMs, entries };
    return entries;
  } catch {
    return [];
  }
}

export async function getRecentShellCommands(opts: {
  limit?: number;
  query?: string;
} = {}): Promise<ShellHistoryEntry[]> {
  const path = resolveHistFile();
  if (!path) return [];

  const entries = await loadHistFile(path);
  const q = opts.query?.trim().toLowerCase() ?? '';

  // Dedup by command text, keep latest timestamp. Walk newest → oldest so the
  // first occurrence wins; preserve that order.
  const seen = new Map<string, ShellHistoryEntry>();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (q && !e.command.toLowerCase().includes(q)) continue;
    if (!seen.has(e.command)) seen.set(e.command, e);
  }

  const deduped = Array.from(seen.values());
  const limit = opts.limit ?? 500;
  return deduped.slice(0, limit);
}
