import uFuzzy from '@leeoniya/ufuzzy';
import { useMemo } from 'react';
import { useSessionStore } from '../../stores/session-store';
import { useDialogStore } from '../../stores/dialog-store';

/** Shared uFuzzy instance for fuzzy filtering. */
const uf = new uFuzzy({ intraMode: 1 });

/** Insert text into the active session PTY or a text-insert target (e.g. dialog field). */
export function insertPromptText(text: string): boolean {
  const target = useDialogStore.getState().textInsertTarget;
  if (target) {
    target(text);
    return true;
  }
  const sessionId = useSessionStore.getState().selectedSessionId;
  if (!sessionId) return false;
  window.mcode.pty.write(sessionId, text);
  return true;
}

/** Truncate text to a max length, appending ellipsis if needed. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '\u2026';
}

/** Format an ISO timestamp as a relative time string. */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Render a snippet template body with variable substitution. */
export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{([^}]+)\}\}/g, (_, raw) => {
    const name = raw.trim();
    return values[name] ?? '';
  });
}

/**
 * Hook that performs fuzzy filtering on a haystack array.
 * Returns the filtered indices in relevance order.
 */
export function useFuzzyFilter<T>(
  items: T[],
  haystack: string[],
  query: string,
): T[] {
  return useMemo(() => {
    if (!query.trim()) return items;

    const idxs = uf.filter(haystack, query);
    if (!idxs || idxs.length === 0) return [];

    const info = uf.info(idxs, haystack, query);
    const order = uf.sort(info, haystack, query);

    return order.map((sortIdx) => items[info.idx[sortIdx]]);
  }, [items, haystack, query]);
}

/** Derive primary cwd from the session store (selected session, or most recent). */
export function usePrimaryCwd(): string | null {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);

  return useMemo(() => {
    const selected = selectedSessionId ? sessions[selectedSessionId] : null;
    if (selected) return selected.cwd;
    const sorted = Object.values(sessions).sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt),
    );
    return sorted[0]?.cwd ?? null;
  }, [sessions, selectedSessionId]);
}
