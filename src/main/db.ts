import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { logger } from './logger';

let db: Database.Database | null = null;

// Embed all migration SQL files at build time via Vite — no runtime filesystem access needed
const migrationModules = import.meta.glob('../../db/migrations/*.sql', {
  query: '?raw',
  eager: true,
}) as Record<string, { default: string }>;

const migrations = Object.entries(migrationModules)
  .map(([path, mod]) => {
    const filename = path.split('/').pop()!;
    const match = filename.match(/^(\d+)/);
    if (!match) return null;
    return { version: parseInt(match[1], 10), filename, sql: mod.default };
  })
  .filter((m): m is { version: number; filename: string; sql: string } => m !== null)
  .sort((a, b) => a.version - b.version);

function applyMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    database
      .prepare('SELECT version FROM schema_version')
      .all()
      .map((row) => (row as { version: number }).version),
  );

  // Check for duplicate version numbers
  const versionSet = new Set<number>();
  for (const m of migrations) {
    if (versionSet.has(m.version)) {
      throw new Error(`Duplicate migration version ${m.version}`);
    }
    versionSet.add(m.version);
  }

  for (const m of migrations) {
    if (applied.has(m.version)) continue;

    const applyMigration = database.transaction(() => {
      database.exec(m.sql);
      database.prepare('INSERT INTO schema_version (version) VALUES (?)').run(m.version);
    });
    applyMigration();
    logger.info('db', `Applied migration ${m.filename}`);
  }
}

export function getDb(): Database.Database {
  if (db) return db;

  const isTest = process.env.NODE_ENV === 'test';
  const dbPath = isTest ? ':memory:' : join(app.getPath('userData'), 'mcode.db');

  if (!isTest) {
    logger.info('db', 'Opening database', { path: dbPath });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  applyMigrations(db);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * ONLY FOR TESTING: Force closes the database and clears the singleton.
 * Next call to getDb() will return a fresh instance.
 */
export function resetDbForTest(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetDbForTest can only be called in test environment');
  }
  closeDb();
}
