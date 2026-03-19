import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { logger } from './logger';

let db: Database.Database | null = null;

function getMigrationsDir(): string {
  // In dev, migrations are at project root; in prod, they're packaged
  if (app.isPackaged) {
    return join(process.resourcesPath, 'db', 'migrations');
  }
  return join(__dirname, '../../db/migrations');
}

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

  const migrationsDir = getMigrationsDir();
  let files: string[];
  try {
    files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    logger.warn('db', 'No migrations directory found', { dir: migrationsDir });
    return;
  }

  // Check for duplicate version numbers
  const versionMap = new Map<number, string>();
  for (const file of files) {
    const match = file.match(/^(\d+)/);
    if (!match) continue;
    const version = parseInt(match[1], 10);
    if (versionMap.has(version)) {
      throw new Error(
        `Duplicate migration version ${version}: ${versionMap.get(version)} and ${file}`,
      );
    }
    versionMap.set(version, file);
  }

  for (const file of files) {
    const match = file.match(/^(\d+)/);
    if (!match) continue;
    const version = parseInt(match[1], 10);
    if (applied.has(version)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    const applyMigration = database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
    });
    applyMigration();
    logger.info('db', `Applied migration ${file}`);
  }
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = join(app.getPath('userData'), 'mcode.db');
  logger.info('db', 'Opening database', { path: dbPath });

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
