import type { SessionInfo } from '../../shared/types';

export interface DateGroup {
  key: string;
  label: string;
  sessions: SessionInfo[];
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateLabel(key: string, todayKey: string, yesterdayKey: string, currentYear: number): string {
  if (key === todayKey) return 'Today';
  if (key === yesterdayKey) return 'Yesterday';
  const date = new Date(key + 'T00:00:00');
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  const year = date.getFullYear();
  return year === currentYear ? `${month} ${day}` : `${month} ${day}, ${year}`;
}

export function groupSessionsByDate(sessions: SessionInfo[]): DateGroup[] {
  const now = new Date();
  const todayKey = toDateKey(now);
  const yesterdayKey = toDateKey(new Date(now.getTime() - 86400000));
  const currentYear = now.getFullYear();

  const groups = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    const key = toDateKey(new Date(session.startedAt));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(session);
  }

  return [...groups.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({
      key,
      label: formatDateLabel(key, todayKey, yesterdayKey, currentYear),
      sessions: groups.get(key)!,
    }));
}
