/** Returns today's date as YYYY-MM-DD. */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Add or subtract `days` from a YYYY-MM-DD string. Noon-anchored to avoid DST issues. */
export function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Format YYYY-MM-DD as "Mar 15" style label. */
export function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Signed day difference: positive when b > a. */
export function daysDiff(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00').getTime();
  const db = new Date(b + 'T12:00:00').getTime();
  return Math.round((db - da) / (86400 * 1000));
}

/** Format an ISO-8601 datetime as a relative "in X" string. Returns '' if past or unparseable. */
export function formatTimeUntil(isoDatetime: string | null): string {
  if (!isoDatetime) return '';
  const target = new Date(isoDatetime).getTime();
  if (isNaN(target)) return '';
  const diffMs = target - Date.now();
  if (diffMs <= 0) return '';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'in < 1m';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `in ${diffMin}m`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hours < 24) return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `in ${days}d ${remHours}h` : `in ${days}d`;
}
