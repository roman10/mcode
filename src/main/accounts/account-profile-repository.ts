import { randomUUID } from 'node:crypto';
import { getDb } from '../db';
import { logger } from '../logger';
import type { AccountProfile } from '../../shared/types';

interface AccountRecord {
  account_id: string;
  name: string;
  email: string | null;
  is_default: number;
  home_dir: string | null;
  created_at: string;
  last_used_at: string | null;
}

function toAccountProfile(row: AccountRecord): AccountProfile {
  return {
    accountId: row.account_id,
    name: row.name,
    email: row.email,
    isDefault: Boolean(row.is_default),
    homeDir: row.home_dir,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * Persistence layer for account profiles.
 * Pure DB operations — no filesystem or provider logic.
 */
export class AccountProfileRepository {
  /** Ensure the default account profile exists. Called on app startup. */
  ensureDefaultAccount(): void {
    const db = getDb();
    const existing = db
      .prepare('SELECT account_id FROM account_profiles WHERE is_default = 1')
      .get() as { account_id: string } | undefined;

    if (existing) return;

    const accountId = randomUUID();
    db.prepare(
      `INSERT INTO account_profiles (account_id, name, email, is_default, home_dir, created_at)
       VALUES (?, ?, NULL, 1, NULL, ?)`,
    ).run(accountId, 'Default', new Date().toISOString());

    logger.info('accounts', 'Created default account profile', { accountId });
  }

  list(): AccountProfile[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM account_profiles ORDER BY is_default DESC, created_at ASC')
      .all() as AccountRecord[];
    return rows.map(toAccountProfile);
  }

  get(accountId: string): AccountProfile | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM account_profiles WHERE account_id = ?')
      .get(accountId) as AccountRecord | undefined;
    return row ? toAccountProfile(row) : null;
  }

  getDefault(): AccountProfile | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM account_profiles WHERE is_default = 1')
      .get() as AccountRecord | undefined;
    return row ? toAccountProfile(row) : null;
  }

  /**
   * Insert a secondary account profile into the database.
   * Does NOT set up the filesystem — that is AccountHomeManager's job.
   */
  insert(name: string, homeDir: string): AccountProfile {
    return this.insertWithId(randomUUID(), name, homeDir);
  }

  /**
   * Insert a secondary account profile with a pre-generated account ID.
   * Used when the caller needs the ID before insert (e.g. to compute the home dir).
   */
  insertWithId(accountId: string, name: string, homeDir: string): AccountProfile {
    const effectiveName = name.trim() || this.nextDefaultName();

    const db = getDb();
    db.prepare(
      `INSERT INTO account_profiles (account_id, name, email, is_default, home_dir, created_at)
       VALUES (?, ?, NULL, 0, ?, ?)`,
    ).run(accountId, effectiveName, homeDir, new Date().toISOString());

    logger.info('accounts', 'Created secondary account', { accountId, name: effectiveName, homeDir });
    return this.get(accountId)!;
  }

  rename(accountId: string, name: string): void {
    const db = getDb();
    const row = db
      .prepare('SELECT account_id FROM account_profiles WHERE account_id = ?')
      .get(accountId) as { account_id: string } | undefined;
    if (!row) throw new Error(`Account not found: ${accountId}`);

    db.prepare('UPDATE account_profiles SET name = ? WHERE account_id = ?')
      .run(name, accountId);
    logger.info('accounts', 'Renamed account', { accountId, name });
  }

  /**
   * Delete a secondary account profile from the database.
   * Returns the home directory path for filesystem cleanup by the caller.
   * Throws if account is default or has active sessions.
   */
  delete(accountId: string): string | null {
    const db = getDb();
    const row = db
      .prepare('SELECT is_default, home_dir FROM account_profiles WHERE account_id = ?')
      .get(accountId) as { is_default: number; home_dir: string | null } | undefined;

    if (!row) throw new Error(`Account not found: ${accountId}`);
    if (row.is_default) throw new Error('Cannot delete the default account');

    const active = db
      .prepare(
        `SELECT 1 FROM sessions WHERE account_id = ? AND status != 'ended' LIMIT 1`,
      )
      .get(accountId);
    if (active) throw new Error('Cannot delete account with active sessions');

    db.prepare('UPDATE sessions SET account_id = NULL WHERE account_id = ?').run(accountId);
    db.prepare('DELETE FROM account_profiles WHERE account_id = ?').run(accountId);

    logger.info('accounts', 'Deleted account', { accountId });
    return row.home_dir;
  }

  touchLastUsed(accountId: string): void {
    const db = getDb();
    db.prepare('UPDATE account_profiles SET last_used_at = ? WHERE account_id = ?')
      .run(new Date().toISOString(), accountId);
  }

  setEmail(accountId: string, email: string): void {
    const db = getDb();
    db.prepare('UPDATE account_profiles SET email = ? WHERE account_id = ?')
      .run(email, accountId);
  }

  /** Generate next default name like "Account 1", "Account 2", etc. */
  nextDefaultName(): string {
    const db = getDb();
    const rows = db
      .prepare("SELECT name FROM account_profiles WHERE is_default = 0 AND name LIKE 'Account %'")
      .all() as { name: string }[];
    let max = 0;
    for (const { name } of rows) {
      const match = name.match(/^Account (\d+)$/);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return `Account ${max + 1}`;
  }
}
