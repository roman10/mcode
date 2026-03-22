import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'sql.js';
import { createTestDb } from './test-db';

const migrationCount = readdirSync(join(__dirname, '../../../db/migrations'))
  .filter((f) => f.endsWith('.sql')).length;

describe('database migrations', () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => {
    db.close();
  });

  it(`applies all ${migrationCount} migrations without errors`, () => {
    const results = db.exec('SELECT version FROM schema_version ORDER BY version');
    const versions = results[0].values.map((row) => row[0] as number);

    expect(versions.length).toBe(migrationCount);
    expect(versions[0]).toBe(1);
    expect(versions[versions.length - 1]).toBe(migrationCount);
  });

  it('creates all expected tables', () => {
    const results = db.exec(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_version' ORDER BY name`,
    );
    const tableNames = results[0].values.map((row) => row[0] as string);

    const expected = [
      'account_profiles',
      'commits',
      'events',
      'layout_state',
      'preferences',
      'sessions',
      'task_queue',
      'token_usage',
      'tracked_jsonl_files',
      'tracked_repos',
    ];

    for (const name of expected) {
      expect(tableNames, `missing table: ${name}`).toContain(name);
    }
  });

  it('enforces foreign key constraints', () => {
    expect(() =>
      db.run(
        `INSERT INTO events (session_id, hook_event_name, payload) VALUES ('nonexistent', 'test', '{}')`,
      ),
    ).toThrow();
  });

  it('allows valid foreign key references', () => {
    db.run(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at)
       VALUES ('test-sess', 'test', '/tmp', 'active', datetime('now'))`,
    );

    expect(() =>
      db.run(
        `INSERT INTO events (session_id, hook_event_name, payload) VALUES ('test-sess', 'test', '{}')`,
      ),
    ).not.toThrow();

    db.run(`DELETE FROM events WHERE session_id = 'test-sess'`);
    db.run(`DELETE FROM sessions WHERE session_id = 'test-sess'`);
  });
});
