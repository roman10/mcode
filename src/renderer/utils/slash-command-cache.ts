import type { SlashCommandEntry } from '@shared/types';
import type { AgentSessionType } from '@shared/session-agents';

type Key = string;

const cache = new Map<Key, Set<string>>();
const inflight = new Map<Key, Promise<Set<string>>>();

function key(sessionType: AgentSessionType, cwd: string): Key {
  return `${sessionType}|${cwd}`;
}

function toSet(commands: SlashCommandEntry[]): Set<string> {
  return new Set(commands.map((cmd) => cmd.name.toLowerCase()));
}

export function getSlashCommandsCached(
  sessionType: AgentSessionType,
  cwd: string,
): Set<string> | undefined {
  return cache.get(key(sessionType, cwd));
}

// Kicks off (or joins) a scan and resolves with the cached set.
// Errors aren't cached so a later attempt can retry; the resolved value is an empty set.
export function ensureSlashCommandsScan(
  sessionType: AgentSessionType,
  cwd: string,
): Promise<Set<string>> {
  const k = key(sessionType, cwd);
  const cached = cache.get(k);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(k);
  if (existing) return existing;
  const p = window.mcode.slashCommands
    .scan(sessionType, cwd)
    .then((commands) => {
      const set = toSet(commands);
      cache.set(k, set);
      inflight.delete(k);
      return set;
    })
    .catch(() => {
      inflight.delete(k);
      return new Set<string>();
    });
  inflight.set(k, p);
  return p;
}

export function _resetSlashCommandCacheForTests(): void {
  cache.clear();
  inflight.clear();
}
