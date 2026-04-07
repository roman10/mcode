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
    getSettingsFileName: () => 'settings.json',
    checkCliInstalled: async () => 'ok',
    checkAuthStatus: async () => ({ status: 'ok' }),
    buildAuthTerminalInput: () => null,
    getInstallHelpUrl: () => undefined,
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
    const accounts = [
      { accountId: 'default', name: 'Default', isDefault: true, homeDir: null, createdAt: '2026-01-01', lastUsedAt: null },
      { accountId: 'work', name: 'Work', isDefault: false, homeDir: '/tmp/work', createdAt: '2026-01-01', lastUsedAt: null },
      { accountId: 'personal', name: 'Personal', isDefault: false, homeDir: '/tmp/personal', createdAt: '2026-01-01', lastUsedAt: null },
    ];

    it('returns empty array when no providers declare a settings file', () => {
      const registry = new AccountProviderRegistry();
      registry.register(createMockAdapter({ getSettingsFileName: () => null }));
      const manager = new AccountHomeManager(registry);
      expect(manager.getAllSettingsPaths(accounts)).toHaveLength(0);
    });

    it('includes primary and secondary paths for a single provider with settings file', () => {
      const registry = new AccountProviderRegistry();
      registry.register(createMockAdapter({ sessionType: 'claude', getConfigDirName: () => '.claude', getSettingsFileName: () => 'settings.json' }));
      const manager = new AccountHomeManager(registry);

      const paths = manager.getAllSettingsPaths(accounts);
      expect(paths).toHaveLength(3); // 1 primary + 2 secondary
      expect(paths[0]).toContain('.claude/settings.json');
      expect(paths[1]).toBe('/tmp/work/.claude/settings.json');
      expect(paths[2]).toBe('/tmp/personal/.claude/settings.json');
    });

    it('returns only primary path when no secondary accounts', () => {
      const registry = new AccountProviderRegistry();
      registry.register(createMockAdapter({ getSettingsFileName: () => 'settings.json' }));
      const manager = new AccountHomeManager(registry);

      const paths = manager.getAllSettingsPaths([
        { accountId: 'default', name: 'Default', isDefault: true, homeDir: null, createdAt: '2026-01-01', lastUsedAt: null },
      ]);
      expect(paths).toHaveLength(1);
    });

    it('includes paths for multiple providers that declare a settings file', () => {
      const registry = new AccountProviderRegistry();
      registry.register(createMockAdapter({ sessionType: 'claude', getConfigDirName: () => '.claude', getSettingsFileName: () => 'settings.json' }));
      registry.register(createMockAdapter({ sessionType: 'gemini', getConfigDirName: () => '.gemini', getSettingsFileName: () => 'settings.json' }));
      registry.register(createMockAdapter({ sessionType: 'copilot', getConfigDirName: () => '.copilot', getSettingsFileName: () => null }));
      const manager = new AccountHomeManager(registry);

      const paths = manager.getAllSettingsPaths(accounts);
      // 2 primaries (claude + gemini) + 2×2 secondaries = 6 total
      expect(paths).toHaveLength(6);
      expect(paths.some((p) => p.includes('.claude/settings.json'))).toBe(true);
      expect(paths.some((p) => p.includes('.gemini/settings.json'))).toBe(true);
      expect(paths.every((p) => !p.includes('.copilot'))).toBe(true);
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
