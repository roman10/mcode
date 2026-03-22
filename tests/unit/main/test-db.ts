import initSqlJs, { type Database } from 'sql.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Create an in-memory SQLite database with all migrations applied.
 * Uses sql.js (WASM) instead of better-sqlite3 to avoid Electron ABI mismatch.
 * Reads migration SQL files directly from db/migrations/ on disk.
 */
export async function createTestDb(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run('PRAGMA foreign_keys = ON');

  const migDir = join(__dirname, '../../../db/migrations');
  const files = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  for (const file of files) {
    const match = file.match(/^(\d+)/);
    if (!match) continue;
    const version = parseInt(match[1], 10);
    const sql = readFileSync(join(migDir, file), 'utf-8');
    db.run('BEGIN');
    db.run(sql);
    db.run('INSERT INTO schema_version (version) VALUES (?)', [version]);
    db.run('COMMIT');
  }

  return db;
}
