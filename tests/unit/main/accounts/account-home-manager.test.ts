import { describe, it, expect } from 'vitest';
import { AccountProviderRegistry } from '../../../../src/main/accounts/account-provider';
import { AccountHomeManager } from '../../../../src/main/accounts/account-home-manager';
import type { AccountProviderAdapter } from '../../../../src/main/accounts/account-provider';

function createMockAdapter(overrides: Partial<AccountProviderAdapter> = {}): AccountProviderAdapter {
  return {
    sessionType: 'claude',
    supportsAccountProfiles: true,
    getConfigDirName: () => '.claude',
    getConfigEnv: () => ({}),
    getSharedConfigSubdirs: () => ['commands', 'skills'],
    checkCliInstalled: async () => 'ok',
    checkAuthStatus: async () => ({ status: 'ok' }),
    buildAuthTerminalInput: () => null,
    getInstallHelpUrl: () => undefined,
    supportsSubscriptionUsage: () => false,
    getSubscriptionUsage: async () => null,
    ...overrides,
  };
}

describe('AccountHomeManager', () => {
  describe('computeHomeDir', () => {
    it('returns path under accounts base', () => {
      const registry = new AccountProviderRegistry();
      const manager = new AccountHomeManager(registry);
      const homeDir = manager.computeHomeDir('test-uuid');
      expect(homeDir).toContain('.mcode/accounts/test-uuid');
    });
  });

  describe('getAllSettingsPaths', () => {
    it('includes primary path and secondary account paths', () => {
      const registry = new AccountProviderRegistry();
      const manager = new AccountHomeManager(registry);

      const accounts = [
        { accountId: 'default', name: 'Default', email: null, isDefault: true, homeDir: null, createdAt: '2026-01-01', lastUsedAt: null },
        { accountId: 'work', name: 'Work', email: null, isDefault: false, homeDir: '/tmp/work', createdAt: '2026-01-01', lastUsedAt: null },
        { accountId: 'personal', name: 'Personal', email: null, isDefault: false, homeDir: '/tmp/personal', createdAt: '2026-01-01', lastUsedAt: null },
      ];

      const paths = manager.getAllSettingsPaths(accounts);
      expect(paths).toHaveLength(3);
      expect(paths[0]).toContain('.claude/settings.json');
      expect(paths[1]).toBe('/tmp/work/.claude/settings.json');
      expect(paths[2]).toBe('/tmp/personal/.claude/settings.json');
    });

    it('returns only primary path when no secondary accounts', () => {
      const registry = new AccountProviderRegistry();
      const manager = new AccountHomeManager(registry);

      const accounts = [
        { accountId: 'default', name: 'Default', email: null, isDefault: true, homeDir: null, createdAt: '2026-01-01', lastUsedAt: null },
      ];

      const paths = manager.getAllSettingsPaths(accounts);
      expect(paths).toHaveLength(1);
    });
  });

  describe('provider denylist integration', () => {
    it('registry with one adapter produces single-entry denylist', () => {
      const registry = new AccountProviderRegistry();
      registry.register(createMockAdapter({ sessionType: 'claude', getConfigDirName: () => '.claude' }));

      const names = registry.getAllConfigDirNames();
      expect(names).toEqual(new Set(['.claude']));
    });

    it('registry with multiple adapters produces union denylist', () => {
      const registry = new AccountProviderRegistry();
      registry.register(createMockAdapter({ sessionType: 'claude', getConfigDirName: () => '.claude' }));
      registry.register(createMockAdapter({ sessionType: 'copilot', getConfigDirName: () => '.copilot' }));
      registry.register(createMockAdapter({ sessionType: 'gemini', getConfigDirName: () => '.gemini' }));
      registry.register(createMockAdapter({ sessionType: 'codex', getConfigDirName: () => '.codex' }));

      const names = registry.getAllConfigDirNames();
      expect(names).toEqual(new Set(['.claude', '.copilot', '.gemini', '.codex']));
    });
  });
});
