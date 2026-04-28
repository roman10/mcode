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

/** Yield YYYY-MM-DD strings for every day between startDateStr and endDateStr (inclusive), local time. */
export function enumerateDates(startDateStr: string, endDateStr: string): string[] {
  const [sy, sm, sd] = startDateStr.split('-').map(Number);
  const [ey, em, ed] = endDateStr.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  const result: string[] = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    result.push(localDateStr(d));
  }
  return result;
}
