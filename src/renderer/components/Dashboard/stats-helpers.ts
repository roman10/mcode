/** Shared formatting helpers used by multiple stats sections. */

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
