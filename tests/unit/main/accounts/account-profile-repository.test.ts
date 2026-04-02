import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getDb, resetDbForTest } from '../../../../src/main/db';
import { AccountProfileRepository } from '../../../../src/main/accounts/account-profile-repository';

describe('AccountProfileRepository', () => {
  const repo = new AccountProfileRepository();

  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM account_profiles').run();
  });

  describe('ensureDefaultAccount', () => {
    it('creates default account if none exists', () => {
      repo.ensureDefaultAccount();
      const def = repo.getDefault();
      expect(def).not.toBeNull();
      expect(def!.name).toBe('Default');
      expect(def!.isDefault).toBe(true);
      expect(def!.homeDir).toBeNull();
    });

    it('is idempotent — does not create a second default', () => {
      repo.ensureDefaultAccount();
      repo.ensureDefaultAccount();
      const all = repo.list();
      const defaults = all.filter((a) => a.isDefault);
      expect(defaults).toHaveLength(1);
    });
  });

  describe('insert', () => {
    it('creates secondary account with given name', () => {
      const account = repo.insert('Work', '/tmp/test-home');
      expect(account.name).toBe('Work');
      expect(account.isDefault).toBe(false);
      expect(account.homeDir).toBe('/tmp/test-home');
    });

    it('generates default name when empty string given', () => {
      const account = repo.insert('', '/tmp/test-home-1');
      expect(account.name).toBe('Account 1');
    });
  });

  describe('list', () => {
    it('returns default account first', () => {
      repo.ensureDefaultAccount();
      repo.insert('Work', '/tmp/home-work');
      const accounts = repo.list();
      expect(accounts[0].isDefault).toBe(true);
      expect(accounts[1].name).toBe('Work');
    });
  });

  describe('get', () => {
    it('returns null for non-existent account', () => {
      expect(repo.get('non-existent-id')).toBeNull();
    });

    it('returns account by id', () => {
      const created = repo.insert('Test', '/tmp/test-get');
      const found = repo.get(created.accountId);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Test');
    });
  });

  describe('rename', () => {
    it('renames an account', () => {
      const account = repo.insert('OldName', '/tmp/test-rename');
      repo.rename(account.accountId, 'NewName');
      expect(repo.get(account.accountId)!.name).toBe('NewName');
    });

    it('throws for non-existent account', () => {
      expect(() => repo.rename('missing', 'NewName')).toThrow('Account not found');
    });
  });

  describe('delete', () => {
    it('deletes secondary account and returns homeDir', () => {
      const account = repo.insert('ToDelete', '/tmp/test-delete');
      const homeDir = repo.delete(account.accountId);
      expect(homeDir).toBe('/tmp/test-delete');
      expect(repo.get(account.accountId)).toBeNull();
    });

    it('throws for default account', () => {
      repo.ensureDefaultAccount();
      const def = repo.getDefault()!;
      expect(() => repo.delete(def.accountId)).toThrow('Cannot delete the default account');
    });

    it('throws for non-existent account', () => {
      expect(() => repo.delete('missing')).toThrow('Account not found');
    });

    it('throws when account has active sessions', () => {
      const account = repo.insert('Active', '/tmp/test-active');
      // Insert a non-ended session referencing this account
      const db = getDb();
      db.prepare(`INSERT INTO sessions (session_id, label, label_source, cwd, status, started_at, session_type, hook_mode, terminal_config, attention_level, auto_close, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'sess-1', 'test', 'auto', '/tmp', 'active', '2026-01-01T00:00:00Z', 'claude', 'live', '{}', 'none', 0, account.accountId,
      );
      expect(() => repo.delete(account.accountId)).toThrow('Cannot delete account with active sessions');
      // Cleanup
      db.prepare('DELETE FROM sessions WHERE session_id = ?').run('sess-1');
    });
  });

  describe('touchLastUsed', () => {
    it('updates last_used_at timestamp', () => {
      const account = repo.insert('Touch', '/tmp/test-touch');
      expect(account.lastUsedAt).toBeNull();
      repo.touchLastUsed(account.accountId);
      const updated = repo.get(account.accountId)!;
      expect(updated.lastUsedAt).not.toBeNull();
    });
  });

  describe('setEmail', () => {
    it('updates email for account in DB (backward compat)', () => {
      const account = repo.insert('EmailTest', '/tmp/test-email');
      // setEmail writes the legacy DB column — verify it does not throw
      expect(() => repo.setEmail(account.accountId, 'test@example.com')).not.toThrow();
      // Verify via raw DB query that the column was updated
      const db = getDb();
      const row = db.prepare('SELECT email FROM account_profiles WHERE account_id = ?').get(account.accountId) as { email: string };
      expect(row.email).toBe('test@example.com');
    });
  });

  describe('nextDefaultName', () => {
    it('generates sequential names', () => {
      expect(repo.nextDefaultName()).toBe('Account 1');
      repo.insert('Account 1', '/tmp/n1');
      expect(repo.nextDefaultName()).toBe('Account 2');
      repo.insert('Account 2', '/tmp/n2');
      expect(repo.nextDefaultName()).toBe('Account 3');
    });
  });
});
