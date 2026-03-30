import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDb, resetDbForTest } from '../../../src/main/db';

const migrationCount = readdirSync(join(__dirname, '../../../db/migrations'))
  .filter((f) => f.endsWith('.sql')).length;

describe('database migrations', () => {
  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  it(`applies all ${migrationCount} migrations without errors`, () => {
    const db = getDb();
    const rows = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version: number }[];
    const versions = rows.map((row) => row.version);

    expect(versions.length).toBe(migrationCount);
    expect(versions[0]).toBe(1);
    expect(versions[versions.length - 1]).toBe(migrationCount);
  });

  it('creates all expected tables', () => {
    const db = getDb();
    const rows = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_version' ORDER BY name`,
    ).all() as { name: string }[];
    const tableNames = rows.map((row) => row.name);

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
    const db = getDb();
    expect(() =>
      db.prepare(
        `INSERT INTO events (session_id, hook_event_name, session_status, payload, created_at) VALUES ('nonexistent', 'test', 'active', '{}', datetime('now'))`,
      ).run(),
    ).toThrow();
  });

  it('allows valid foreign key references', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sessions (session_id, label, cwd, status, started_at, session_type, hook_mode)
       VALUES ('test-sess', 'test', '/tmp', 'active', datetime('now'), 'claude', 'live')`,
    ).run();

    expect(() =>
      db.prepare(
        `INSERT INTO events (session_id, hook_event_name, session_status, payload, created_at) VALUES ('test-sess', 'test', 'active', '{}', datetime('now'))`,
      ).run(),
    ).not.toThrow();

    db.prepare(`DELETE FROM events WHERE session_id = 'test-sess'`).run();
    db.prepare(`DELETE FROM sessions WHERE session_id = 'test-sess'`).run();
  });
});
