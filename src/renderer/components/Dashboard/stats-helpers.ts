/** Shared formatting helpers used by multiple stats sections. */

import { daysDiff, todayStr } from '../../utils/date-nav';

/** Sum entries within 7, 30, and 90-day windows ending today. */
export function computeRollups<T extends { date: string }>(
  entries: T[],
  getValue: (e: T) => number,
): { d7: number; d30: number; d90: number } {
  const today = todayStr();
  let d7 = 0, d30 = 0, d90 = 0;
  for (const e of entries) {
    const diff = daysDiff(e.date, today); // today - entry.date (positive = past)
    if (diff < 0 || diff >= 90) continue;
    const v = getValue(e);
    if (diff < 7) d7 += v;
    if (diff < 30) d30 += v;
    d90 += v;
  }
  return { d7, d30, d90 };
}

export function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatHour(hour: string): string {
  const h = parseInt(hour, 10);
  const nextH = (h + 1) % 24;
  const fmt = (v: number): string => {
    if (v === 0) return '12 AM';
    if (v < 12) return `${v} AM`;
    if (v === 12) return '12 PM';
    return `${v - 12} PM`;
  };
  return `${fmt(h)}-${fmt(nextH)}`;
}
