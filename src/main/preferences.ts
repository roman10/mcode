import { getDb } from './db';

export function getPreference(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM preferences WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setPreference(key: string, value: string): void {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run(key, value);
}

export function getPreferenceBool(key: string, defaultValue: boolean): boolean {
  const raw = getPreference(key);
  if (raw === null) return defaultValue;
  return raw === 'true';
}

export function setPreferenceBool(key: string, value: boolean): void {
  setPreference(key, value ? 'true' : 'false');
}
