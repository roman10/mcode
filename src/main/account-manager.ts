import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, symlinkSync, copyFileSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from './db';
import { logger } from './logger';
import type { AccountProfile } from '../shared/types';

const execFileAsync = promisify(execFile);

const ACCOUNTS_BASE = join(homedir(), '.mcode', 'accounts');

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

export class AccountManager {
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
   * Create a secondary account profile.
   * Sets up the account home directory with symlinks mirroring the real home.
   */
  create(name: string): AccountProfile {
    const accountId = randomUUID();
    const accountHome = join(ACCOUNTS_BASE, accountId);

    // Create the account home directory and set up symlinks
    this.setupAccountDirectory(accountHome);

    const db = getDb();
    db.prepare(
      `INSERT INTO account_profiles (account_id, name, email, is_default, home_dir, created_at)
       VALUES (?, ?, NULL, 0, ?, ?)`,
    ).run(accountId, name, accountHome, new Date().toISOString());

    logger.info('accounts', 'Created secondary account', { accountId, name, homeDir: accountHome });

    return this.get(accountId)!;
  }

  /** Delete a secondary account profile and remove its home directory. */
  delete(accountId: string): void {
    const db = getDb();
    const row = db
      .prepare('SELECT is_default, home_dir FROM account_profiles WHERE account_id = ?')
      .get(accountId) as { is_default: number; home_dir: string | null } | undefined;

    if (!row) throw new Error(`Account not found: ${accountId}`);
    if (row.is_default) throw new Error('Cannot delete the default account');

    // Check no active sessions use this account
    const active = db
      .prepare(
        `SELECT 1 FROM sessions WHERE account_id = ? AND status != 'ended' LIMIT 1`,
      )
      .get(accountId);
    if (active) throw new Error('Cannot delete account with active sessions');

    db.prepare('UPDATE sessions SET account_id = NULL WHERE account_id = ?').run(accountId);
    db.prepare('DELETE FROM account_profiles WHERE account_id = ?').run(accountId);

    // Remove the account home directory (symlinks are removed, not followed).
    // Safety: only delete if the path is inside the expected base directory.
    const resolvedHome = row.home_dir ? resolve(row.home_dir) : null;
    if (resolvedHome && resolvedHome.startsWith(ACCOUNTS_BASE + '/') && existsSync(resolvedHome)) {
      try {
        rmSync(resolvedHome, { recursive: true });
        logger.info('accounts', 'Removed account home directory', { accountId, homeDir: resolvedHome });
      } catch (err) {
        logger.warn('accounts', 'Failed to remove account home directory', {
          accountId,
          homeDir: resolvedHome,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('accounts', 'Deleted account', { accountId });
  }

  /** Update last_used_at timestamp when a session uses this account. */
  touchLastUsed(accountId: string): void {
    const db = getDb();
    db.prepare('UPDATE account_profiles SET last_used_at = ? WHERE account_id = ?')
      .run(new Date().toISOString(), accountId);
  }

  /** Update email after authentication. */
  setEmail(accountId: string, email: string): void {
    const db = getDb();
    db.prepare('UPDATE account_profiles SET email = ? WHERE account_id = ?')
      .run(email, accountId);
  }

  /**
   * Re-sync symlinks in an account's home directory.
   * Scans real HOME for entries not yet symlinked (skipping .claude/).
   * Fast: only creates missing symlinks, doesn't touch existing ones.
   */
  syncSymlinks(accountId: string): void {
    const account = this.get(accountId);
    if (!account || account.isDefault || !account.homeDir) return;

    const realHome = homedir();
    const accountHome = account.homeDir;

    if (!existsSync(accountHome)) {
      this.setupAccountDirectory(accountHome);
      return;
    }

    const realEntries = readdirSync(realHome, { withFileTypes: true });
    for (const entry of realEntries) {
      // Never symlink .claude — that's the whole point of isolation
      if (entry.name === '.claude') continue;

      const targetPath = join(accountHome, entry.name);
      if (existsSync(targetPath)) continue; // already exists (symlink or real)

      const sourcePath = join(realHome, entry.name);
      try {
        symlinkSync(sourcePath, targetPath);
      } catch {
        // Skip entries that can't be symlinked (permission issues, etc.)
      }
    }
  }

  /**
   * Get the environment variables to set for a session using this account.
   * Returns empty object for the default account (no override needed).
   */
  getSessionEnv(accountId: string | undefined): Record<string, string> {
    if (!accountId) return {};

    const account = this.get(accountId);
    if (!account || account.isDefault || !account.homeDir) return {};

    // Re-sync symlinks before spawning
    this.syncSymlinks(accountId);

    return { HOME: account.homeDir };
  }

  /**
   * Check auth status for an account by running `claude auth status --json`.
   */
  async getAuthStatus(accountId: string): Promise<{ loggedIn: boolean; email?: string }> {
    const account = this.get(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);

    const env = account.isDefault
      ? { ...process.env }
      : { ...process.env, HOME: account.homeDir! };

    try {
      const { stdout } = await execFileAsync('claude', ['auth', 'status', '--json'], { env });
      const status = JSON.parse(stdout) as { loggedIn?: boolean; email?: string };
      return { loggedIn: Boolean(status.loggedIn), email: status.email };
    } catch {
      return { loggedIn: false };
    }
  }

  /**
   * Get all settings.json paths that need hook reconciliation.
   * Returns the primary path plus all secondary account paths.
   */
  getAllSettingsPaths(): string[] {
    const primary = join(homedir(), '.claude', 'settings.json');
    const paths = [primary];

    const accounts = this.list();
    for (const account of accounts) {
      if (!account.isDefault && account.homeDir) {
        paths.push(join(account.homeDir, '.claude', 'settings.json'));
      }
    }

    return paths;
  }

  // --- Private ---

  private setupAccountDirectory(accountHome: string): void {
    const realHome = homedir();

    // Create account home and its .claude directory
    mkdirSync(join(accountHome, '.claude'), { recursive: true });

    // Symlink everything from real HOME except .claude
    const entries = readdirSync(realHome, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.claude') continue;

      const sourcePath = join(realHome, entry.name);
      const targetPath = join(accountHome, entry.name);

      // Skip if target already exists (e.g. from a previous partial setup)
      if (existsSync(targetPath)) continue;

      try {
        symlinkSync(sourcePath, targetPath);
      } catch {
        // Skip entries that can't be symlinked
        logger.warn('accounts', 'Failed to symlink', { source: sourcePath, target: targetPath });
      }
    }

    // Copy settings.json to the new account's .claude/ so hooks work
    const primarySettings = join(realHome, '.claude', 'settings.json');
    if (existsSync(primarySettings)) {
      copyFileSync(primarySettings, join(accountHome, '.claude', 'settings.json'));
    }

    logger.info('accounts', 'Set up account directory', { accountHome });
  }
}
