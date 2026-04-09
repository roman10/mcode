import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createGeminiAccountProvider } from '../../../../src/main/accounts/providers/gemini-account-provider';

describe('GeminiAccountProvider', () => {
  const adapter = createGeminiAccountProvider();

  it('has correct session type', () => {
    expect(adapter.sessionType).toBe('gemini');
  });

  it('supports account profiles', () => {
    expect(adapter.supportsAccountProfiles).toBe(true);
  });

  it('returns .gemini as config dir name', () => {
    expect(adapter.getConfigDirName()).toBe('.gemini');
  });

  it('returns GEMINI_CLI_HOME pointing to parent dir + GEMINI_FORCE_FILE_STORAGE', () => {
    const env = adapter.getConfigEnv('/home/test-account');
    expect(env).toEqual({
      GEMINI_CLI_HOME: '/home/test-account',
      GEMINI_FORCE_FILE_STORAGE: 'true',
    });
    expect(env).not.toHaveProperty('HOME');
  });

  it('returns shared subdirs for user-authored commands', () => {
    expect(adapter.getSharedConfigSubdirs()).toEqual(['commands']);
  });

  it('returns empty shared settings keys (hook config managed by bridge)', () => {
    expect(adapter.getSharedSettingsKeys()).toEqual([]);
  });

  it('returns null for settings file name (uses own hook bridge)', () => {
    expect(adapter.getSettingsFileName()).toBeNull();
  });

  it('returns install help URL', () => {
    expect(adapter.getInstallHelpUrl()).toBe('https://github.com/google-gemini/gemini-cli');
  });

  it('builds auth terminal input for secondary account — launches REPL for /auth', () => {
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
      label: 'Auth: Test Account \u2014 run /auth',
      sessionType: 'terminal',
      accountId: 'test-id',
      initialCommand: 'gemini',
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
      tmpDir = join(tmpdir(), `gemini-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(join(tmpDir, '.gemini'), { recursive: true });
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

    it('returns not-authenticated when google_accounts.json is missing', async () => {
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('not-authenticated');
    });

    it('returns not-authenticated when active field is absent', async () => {
      writeFileSync(
        join(tmpDir, '.gemini', 'google_accounts.json'),
        JSON.stringify({ old: [] }),
      );
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('not-authenticated');
    });

    it('returns not-authenticated when active field is null', async () => {
      writeFileSync(
        join(tmpDir, '.gemini', 'google_accounts.json'),
        JSON.stringify({ active: null, old: [] }),
      );
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('not-authenticated');
    });

    it('returns not-authenticated when file is invalid JSON', async () => {
      writeFileSync(join(tmpDir, '.gemini', 'google_accounts.json'), 'not-json');
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('not-authenticated');
    });

    it('returns ok with email identity when active is set', async () => {
      writeFileSync(
        join(tmpDir, '.gemini', 'google_accounts.json'),
        JSON.stringify({ active: 'user@gmail.com', old: [] }),
      );
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('ok');
      expect(result.identity).toBe('user@gmail.com');
      expect(result.displayName).toBe('user@gmail.com');
    });

    it('returns not-authenticated when active is empty string', async () => {
      writeFileSync(
        join(tmpDir, '.gemini', 'google_accounts.json'),
        JSON.stringify({ active: '', old: [] }),
      );
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('not-authenticated');
    });
  });
});
