import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createCodexAccountProvider } from '../../../../src/main/accounts/providers/codex-account-provider';

describe('CodexAccountProvider', () => {
  const adapter = createCodexAccountProvider();

  it('has correct session type', () => {
    expect(adapter.sessionType).toBe('codex');
  });

  it('supports account profiles', () => {
    expect(adapter.supportsAccountProfiles).toBe(true);
  });

  it('returns .codex as config dir name', () => {
    expect(adapter.getConfigDirName()).toBe('.codex');
  });

  it('returns CODEX_HOME env var — does NOT override HOME', () => {
    const env = adapter.getConfigEnv('/home/test-account');
    expect(env).toEqual({
      CODEX_HOME: '/home/test-account/.codex',
    });
    expect(env).not.toHaveProperty('HOME');
  });

  it('returns shared subdirs for user-authored content', () => {
    expect(adapter.getSharedConfigSubdirs()).toEqual(['rules', 'skills', 'memories']);
  });

  it('returns empty shared settings keys (uses config.toml, not JSON)', () => {
    expect(adapter.getSharedSettingsKeys()).toEqual([]);
  });

  it('returns null for settings file name (uses own hook bridge)', () => {
    expect(adapter.getSettingsFileName()).toBeNull();
  });

  it('returns install help URL', () => {
    expect(adapter.getInstallHelpUrl()).toBe('https://codex.openai.com/');
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
      initialCommand: 'codex login',
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
      tmpDir = join(tmpdir(), `codex-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(join(tmpDir, '.codex'), { recursive: true });
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

    it('returns not-authenticated when auth.json is missing', async () => {
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('not-authenticated');
    });

    it('returns not-authenticated when auth.json has no auth_mode', async () => {
      writeFileSync(
        join(tmpDir, '.codex', 'auth.json'),
        JSON.stringify({ OPENAI_API_KEY: null }),
      );
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('not-authenticated');
    });

    it('returns not-authenticated when auth.json is invalid JSON', async () => {
      writeFileSync(join(tmpDir, '.codex', 'auth.json'), 'not-json');
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('not-authenticated');
    });

    it('returns ok with identity for chatgpt auth mode', async () => {
      writeFileSync(
        join(tmpDir, '.codex', 'auth.json'),
        JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null }),
      );
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('ok');
      expect(result.identity).toBe('chatgpt');
      expect(result.displayName).toBe('ChatGPT');
    });

    it('returns ok with identity for api_key auth mode', async () => {
      writeFileSync(
        join(tmpDir, '.codex', 'auth.json'),
        JSON.stringify({ auth_mode: 'api_key' }),
      );
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('ok');
      expect(result.identity).toBe('api_key');
      expect(result.displayName).toBe('API Key');
    });

    it('returns ok with identity for device_code auth mode', async () => {
      writeFileSync(
        join(tmpDir, '.codex', 'auth.json'),
        JSON.stringify({ auth_mode: 'device_code' }),
      );
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('ok');
      expect(result.identity).toBe('device_code');
      expect(result.displayName).toBe('Device Code');
    });

    it('returns ok with raw auth_mode for unknown modes', async () => {
      writeFileSync(
        join(tmpDir, '.codex', 'auth.json'),
        JSON.stringify({ auth_mode: 'future_mode' }),
      );
      const result = await adapter.checkAuthStatus(makeAccount(tmpDir));
      expect(result.status).toBe('ok');
      expect(result.identity).toBe('future_mode');
      expect(result.displayName).toBe('future_mode');
    });
  });
});
