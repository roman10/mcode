import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getDb, resetDbForTest } from '../../../../src/main/db';
import { truncateTestData } from '../../db-helpers';
import { AccountIdentityRepository } from '../../../../src/main/accounts/account-identity-repository';
import { AccountProfileRepository } from '../../../../src/main/accounts/account-profile-repository';

describe('AccountIdentityRepository', () => {
  let repo: AccountIdentityRepository;
  let profileRepo: AccountProfileRepository;
  let testAccountId: string;

  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    const db = getDb();
    truncateTestData(db);

    repo = new AccountIdentityRepository();
    profileRepo = new AccountProfileRepository();

    // Create a test account to satisfy FK constraint
    profileRepo.ensureDefaultAccount();
    const account = profileRepo.insert('Test', '/tmp/test-identity');
    testAccountId = account.accountId;
  });

  describe('get', () => {
    it('returns null for non-existent identity', () => {
      expect(repo.get(testAccountId, 'claude')).toBeNull();
    });

    it('returns identity after upsert', () => {
      repo.upsert(testAccountId, 'claude', 'ok', 'test@example.com', 'Test User');
      const row = repo.get(testAccountId, 'claude');
      expect(row).not.toBeNull();
      expect(row!.accountId).toBe(testAccountId);
      expect(row!.sessionType).toBe('claude');
      expect(row!.authStatus).toBe('ok');
      expect(row!.identity).toBe('test@example.com');
      expect(row!.displayName).toBe('Test User');
      expect(row!.lastCheckedAt).not.toBeNull();
      expect(row!.lastAuthenticatedAt).not.toBeNull();
    });
  });

  describe('list', () => {
    it('returns empty array for account with no identities', () => {
      expect(repo.list(testAccountId)).toEqual([]);
    });

    it('returns all identities for an account', () => {
      repo.upsert(testAccountId, 'claude', 'ok', 'test@example.com');
      repo.upsert(testAccountId, 'copilot', 'ok', 'waterdrop86');
      const rows = repo.list(testAccountId);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.sessionType).sort()).toEqual(['claude', 'copilot']);
    });
  });

  describe('upsert', () => {
    it('inserts new identity', () => {
      repo.upsert(testAccountId, 'claude', 'ok', 'test@example.com');
      const row = repo.get(testAccountId, 'claude')!;
      expect(row.authStatus).toBe('ok');
      expect(row.identity).toBe('test@example.com');
    });

    it('updates existing identity on conflict', () => {
      repo.upsert(testAccountId, 'claude', 'not-authenticated');
      repo.upsert(testAccountId, 'claude', 'ok', 'updated@example.com');
      const row = repo.get(testAccountId, 'claude')!;
      expect(row.authStatus).toBe('ok');
      expect(row.identity).toBe('updated@example.com');
    });

    it('preserves existing identity when new value is null', () => {
      repo.upsert(testAccountId, 'claude', 'ok', 'test@example.com');
      repo.upsert(testAccountId, 'claude', 'not-authenticated');
      const row = repo.get(testAccountId, 'claude')!;
      expect(row.authStatus).toBe('not-authenticated');
      // identity preserved via COALESCE
      expect(row.identity).toBe('test@example.com');
    });

    it('sets lastAuthenticatedAt only when status is ok', () => {
      repo.upsert(testAccountId, 'claude', 'not-authenticated');
      const row1 = repo.get(testAccountId, 'claude')!;
      expect(row1.lastAuthenticatedAt).toBeNull();

      repo.upsert(testAccountId, 'claude', 'ok', 'test@example.com');
      const row2 = repo.get(testAccountId, 'claude')!;
      expect(row2.lastAuthenticatedAt).not.toBeNull();
    });
  });

  describe('listAll', () => {
    it('returns all identities across all accounts', () => {
      const other = profileRepo.insert('Other', '/tmp/other-listall');
      repo.upsert(testAccountId, 'claude', 'ok', 'a@example.com');
      repo.upsert(other.accountId, 'claude', 'ok', 'b@example.com');

      const rows = repo.listAll();
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const accountIds = rows.map((r) => r.accountId);
      expect(accountIds).toContain(testAccountId);
      expect(accountIds).toContain(other.accountId);
    });

    it('returns empty array when no identities exist', () => {
      expect(repo.listAll()).toEqual([]);
    });
  });

  describe('deleteAll', () => {
    it('removes all identities for an account', () => {
      repo.upsert(testAccountId, 'claude', 'ok', 'test@example.com');
      repo.upsert(testAccountId, 'copilot', 'ok', 'waterdrop86');
      expect(repo.list(testAccountId)).toHaveLength(2);

      repo.deleteAll(testAccountId);
      expect(repo.list(testAccountId)).toHaveLength(0);
    });

    it('does not affect other accounts', () => {
      const other = profileRepo.insert('Other', '/tmp/other');
      repo.upsert(testAccountId, 'claude', 'ok', 'a@example.com');
      repo.upsert(other.accountId, 'claude', 'ok', 'b@example.com');

      repo.deleteAll(testAccountId);
      expect(repo.list(testAccountId)).toHaveLength(0);
      expect(repo.list(other.accountId)).toHaveLength(1);
    });
  });

  describe('FK cascade', () => {
    it('identities are deleted when account profile is deleted', () => {
      repo.upsert(testAccountId, 'claude', 'ok', 'test@example.com');
      expect(repo.list(testAccountId)).toHaveLength(1);

      profileRepo.delete(testAccountId);
      expect(repo.list(testAccountId)).toHaveLength(0);
    });
  });
});
