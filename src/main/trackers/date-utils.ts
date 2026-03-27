/** Format a Date as YYYY-MM-DD in the local timezone. */
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayDate(): string {
  return localDateStr(new Date());
}

export function nDaysAgoStart(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateStr(d) + 'T00:00:00';
}
