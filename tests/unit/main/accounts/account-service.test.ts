import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getDb, resetDbForTest } from '../../../../src/main/db';
import { AccountProviderRegistry } from '../../../../src/main/accounts/account-provider';
import { AccountProfileRepository } from '../../../../src/main/accounts/account-profile-repository';
import { AccountHomeManager } from '../../../../src/main/accounts/account-home-manager';
import { AccountService } from '../../../../src/main/accounts/account-service';
import { createClaudeAccountProvider } from '../../../../src/main/accounts/providers/claude-account-provider';

function createService() {
  const registry = new AccountProviderRegistry();
  registry.register(createClaudeAccountProvider());
  const repo = new AccountProfileRepository();
  const homeManager = new AccountHomeManager(registry);
  return new AccountService(repo, homeManager, registry);
}

describe('AccountService', () => {
  let service: AccountService;

  beforeAll(() => {
    resetDbForTest();
  });

  afterAll(() => {
    resetDbForTest();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM account_profiles').run();
    service = createService();
  });

  describe('getSessionEnv', () => {
    it('returns empty object for undefined accountId', () => {
      expect(service.getSessionEnv(undefined)).toEqual({});
    });

    it('returns empty object for default account', () => {
      service.ensureDefaultAccount();
      const def = service.getDefault()!;
      expect(service.getSessionEnv(def.accountId, 'claude')).toEqual({});
    });

    it('returns empty object for non-existent accountId', () => {
      expect(service.getSessionEnv('non-existent', 'claude')).toEqual({});
    });

    it('returns Claude env for secondary account with claude sessionType', () => {
      service.ensureDefaultAccount();
      // Insert a secondary account directly in DB (skip filesystem setup)
      const repo = new AccountProfileRepository();
      const account = repo.insert('Test', '/tmp/test-session-env');
      const env = service.getSessionEnv(account.accountId, 'claude');
      expect(env).toEqual({
        HOME: '/tmp/test-session-env',
        CLAUDE_CONFIG_DIR: '/tmp/test-session-env/.claude',
      });
    });

    it('returns merged env for terminal sessions (no adapter)', () => {
      service.ensureDefaultAccount();
      const repo = new AccountProfileRepository();
      const account = repo.insert('Test', '/tmp/test-terminal-env');
      // sessionType 'terminal' has no adapter — should merge all registered adapters
      const env = service.getSessionEnv(account.accountId, 'terminal');
      // With only Claude registered, this should produce same result as Claude adapter
      expect(env).toEqual({
        HOME: '/tmp/test-terminal-env',
        CLAUDE_CONFIG_DIR: '/tmp/test-terminal-env/.claude',
      });
    });

    it('returns merged env when sessionType is undefined', () => {
      service.ensureDefaultAccount();
      const repo = new AccountProfileRepository();
      const account = repo.insert('Test', '/tmp/test-no-type');
      const env = service.getSessionEnv(account.accountId);
      // Should merge all registered adapters (Claude only in Phase 1)
      expect(env).toEqual({
        HOME: '/tmp/test-no-type',
        CLAUDE_CONFIG_DIR: '/tmp/test-no-type/.claude',
      });
    });
  });

  describe('CRUD delegation', () => {
    it('ensureDefaultAccount + list + getDefault', () => {
      service.ensureDefaultAccount();
      const accounts = service.list();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].isDefault).toBe(true);

      const def = service.getDefault();
      expect(def).not.toBeNull();
      expect(def!.accountId).toBe(accounts[0].accountId);
    });

    it('get returns account by id', () => {
      service.ensureDefaultAccount();
      const def = service.getDefault()!;
      expect(service.get(def.accountId)).toEqual(def);
    });

    it('get returns null for non-existent', () => {
      expect(service.get('missing')).toBeNull();
    });

    it('rename delegates to repo', () => {
      service.ensureDefaultAccount();
      const def = service.getDefault()!;
      service.rename(def.accountId, 'Renamed');
      expect(service.get(def.accountId)!.name).toBe('Renamed');
    });

    it('touchLastUsed updates timestamp', () => {
      service.ensureDefaultAccount();
      const def = service.getDefault()!;
      expect(def.lastUsedAt).toBeNull();
      service.touchLastUsed(def.accountId);
      expect(service.get(def.accountId)!.lastUsedAt).not.toBeNull();
    });

    it('setEmail updates email', () => {
      service.ensureDefaultAccount();
      const def = service.getDefault()!;
      service.setEmail(def.accountId, 'test@example.com');
      expect(service.get(def.accountId)!.email).toBe('test@example.com');
    });
  });

  describe('getAllSettingsPaths', () => {
    it('returns paths for all accounts', () => {
      service.ensureDefaultAccount();
      // Insert a secondary account directly (skip filesystem)
      const repo = new AccountProfileRepository();
      repo.insert('Secondary', '/tmp/secondary');

      const paths = service.getAllSettingsPaths();
      expect(paths).toHaveLength(2);
      expect(paths[0]).toContain('.claude/settings.json');
      expect(paths[1]).toBe('/tmp/secondary/.claude/settings.json');
    });
  });
});
