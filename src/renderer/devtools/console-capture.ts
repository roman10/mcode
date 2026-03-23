import type { ConsoleEntry } from '@shared/types';

const MAX_ENTRIES = 500;
const entries: ConsoleEntry[] = [];

export function initConsoleCapture(): void {
  for (const level of ['log', 'warn', 'error', 'info'] as const) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      entries.push({
        level,
        timestamp: Date.now(),
        args: args.map((a) => {
          if (typeof a === 'string') return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        }),
      });
      if (entries.length > MAX_ENTRIES) entries.shift();
      original.apply(console, args);
    };
  }
}

export function getEntries(limit?: number): ConsoleEntry[] {
  if (limit && limit > 0) {
    return entries.slice(-limit);
  }
  return [...entries];
}
