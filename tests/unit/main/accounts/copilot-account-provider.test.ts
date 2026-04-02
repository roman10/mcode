import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createCopilotAccountProvider } from '../../../../src/main/accounts/providers/copilot-account-provider';

describe('CopilotAccountProvider', () => {
  const adapter = createCopilotAccountProvider();

  it('has correct session type', () => {
    expect(adapter.sessionType).toBe('copilot');
  });

  it('supports account profiles', () => {
    expect(adapter.supportsAccountProfiles).toBe(true);
  });

  it('returns .copilot as config dir name', () => {
    expect(adapter.getConfigDirName()).toBe('.copilot');
  });

  it('returns COPILOT_HOME env var — does NOT override HOME', () => {
    const env = adapter.getConfigEnv('/home/test-account');
    expect(env).toEqual({
      COPILOT_HOME: '/home/test-account/.copilot',
    });
    // Ensure HOME is not overridden (Keychain breaks if HOME is changed)
    expect(env).not.toHaveProperty('HOME');
  });

  it('returns empty shared subdirs', () => {
    expect(adapter.getSharedConfigSubdirs()).toEqual([]);
  });

  it('returns install help URL', () => {
    expect(adapter.getInstallHelpUrl()).toBe(
      'https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started',
    );
  });

  it('does not support subscription usage', () => {
    expect(adapter.supportsSubscriptionUsage()).toBe(false);
  });

  it('returns null for subscription usage', async () => {
    const account = {
      accountId: 'test',
      name: 'Test',
      isDefault: false,
      homeDir: '/tmp/test',
      createdAt: '2026-01-01T00:00:00Z',
      lastUsedAt: null,
    };
    expect(await adapter.getSubscriptionUsage(account)).toBeNull();
  });

  it('builds auth terminal input for secondary account', () => {
    const account = {
      accountId: 'test-id',
      name: 'Test Account',
      isDefault: false,
      homeDir: '/home/test-account',
      createdAt: '2026-01-01T00:00:00Z',
      lastUsedAt: null,
    };
    const input = adapter.buildAuthTerminalInput(account);
    expect(input).toEqual({
      cwd: '/home/test-account',
      label: 'Auth: Test Account',
      sessionType: 'terminal',
      accountId: 'test-id',
      initialCommand: 'copilot login --config-dir "/home/test-account/.copilot"',
    });
  });

  it('returns null for default account auth terminal input', () => {
    const account = {
      accountId: 'default-id',
      name: 'Default',
      isDefault: true,
      homeDir: null,
      createdAt: '2026-01-01T00:00:00Z',
      lastUsedAt: null,
    };
    expect(adapter.buildAuthTerminalInput(account)).toBeNull();
  });

  describe('checkAuthStatus', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = join(tmpdir(), `copilot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(join(tmpDir, '.copilot'), { recursive: true });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    const makeAccount = (homeDir: string) => ({
      accountId: 'test-id',
      name: 'Test',
      isDefault: false,
      homeDir,
      createdAt: '2026-01-01T00:00:00Z',
      lastUsedAt: null,
    });

    it('returns not-authenticated when config.json is missing', async () => {
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('not-authenticated');
    });

    it('returns not-authenticated when logged_in_users is empty', async () => {
      writeFileSync(
        join(tmpDir, '.copilot', 'config.json'),
        JSON.stringify({ version: 1, logged_in_users: [] }),
      );
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('not-authenticated');
    });

    it('returns not-authenticated when logged_in_users is absent', async () => {
      writeFileSync(join(tmpDir, '.copilot', 'config.json'), JSON.stringify({ version: 1 }));
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('not-authenticated');
    });

    it('returns not-authenticated when config.json is invalid JSON', async () => {
      writeFileSync(join(tmpDir, '.copilot', 'config.json'), 'not-json');
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('not-authenticated');
    });

    it('returns ok with identity when logged_in_users is a string array', async () => {
      writeFileSync(
        join(tmpDir, '.copilot', 'config.json'),
        JSON.stringify({ version: 1, logged_in_users: ['waterdrop86'] }),
      );
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('ok');
      expect(result.identity).toBe('waterdrop86');
      expect(result.displayName).toBe('waterdrop86');
    });

    it('returns ok with identity when logged_in_users contains objects with github_user', async () => {
      writeFileSync(
        join(tmpDir, '.copilot', 'config.json'),
        JSON.stringify({
          version: 1,
          logged_in_users: [{ github_user: 'waterdrop86' }],
        }),
      );
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('ok');
      expect(result.identity).toBe('waterdrop86');
    });

    it('returns ok with null identity when user entry has unknown format', async () => {
      writeFileSync(
        join(tmpDir, '.copilot', 'config.json'),
        JSON.stringify({ version: 1, logged_in_users: [{ unknown_field: 'data' }] }),
      );
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('ok');
      expect(result.identity).toBeNull();
    });
  });
});
