import { describe, it, expect } from 'vitest';
import { createClaudeAccountProvider } from '../../../../src/main/accounts/providers/claude-account-provider';

describe('ClaudeAccountProvider', () => {
  const adapter = createClaudeAccountProvider();

  it('has correct session type', () => {
    expect(adapter.sessionType).toBe('claude');
  });

  it('supports account profiles', () => {
    expect(adapter.supportsAccountProfiles).toBe(true);
  });

  it('returns .claude as config dir name', () => {
    expect(adapter.getConfigDirName()).toBe('.claude');
  });

  it('returns correct config env for account home', () => {
    const env = adapter.getConfigEnv('/home/test-account');
    expect(env).toEqual({
      HOME: '/home/test-account',
      CLAUDE_CONFIG_DIR: '/home/test-account/.claude',
    });
  });

  it('returns shared subdirs', () => {
    const subdirs = adapter.getSharedConfigSubdirs();
    expect(subdirs).toEqual(['commands', 'skills', 'plugins', 'projects']);
  });

  it('returns install help URL', () => {
    expect(adapter.getInstallHelpUrl()).toBe('https://docs.anthropic.com/en/docs/claude-code/overview');
  });

  it('supports subscription usage', () => {
    expect(adapter.supportsSubscriptionUsage()).toBe(true);
  });

  it('builds auth terminal input for secondary account', () => {
    const account = {
      accountId: 'test-id',
      name: 'Test Account',
      email: null,
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
      initialCommand: 'claude auth login',
    });
  });

  it('returns null for default account auth terminal input', () => {
    const account = {
      accountId: 'default-id',
      name: 'Default',
      email: null,
      isDefault: true,
      homeDir: null,
      createdAt: '2026-01-01T00:00:00Z',
      lastUsedAt: null,
    };

    expect(adapter.buildAuthTerminalInput(account)).toBeNull();
  });
});
