import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, symlinkSync, lstatSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

  describe('listAllAccountPaths', () => {
    // The helper always includes join(homedir(), relativePath) and filters
    // to existing dirs. Tests assert on secondary-path behavior and tolerate
    // the real-home entry being present or absent.
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = join(tmpdir(), `ahm-paths-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('includes each existing secondary account dir', () => {
      const work = join(tmpDir, 'work');
      const personal = join(tmpDir, 'personal');
      mkdirSync(join(work, '.copilot', 'session-state'), { recursive: true });
      mkdirSync(join(personal, '.copilot', 'session-state'), { recursive: true });

      const registry = new AccountProviderRegistry();
      const manager = new AccountHomeManager(registry);
      const paths = manager.listAllAccountPaths(
        [
          { accountId: 'default', name: 'Default', isDefault: true, homeDir: null, createdAt: '2026-01-01', lastUsedAt: null },
          { accountId: 'work', name: 'Work', isDefault: false, homeDir: work, createdAt: '2026-01-01', lastUsedAt: null },
          { accountId: 'personal', name: 'Personal', isDefault: false, homeDir: personal, createdAt: '2026-01-01', lastUsedAt: null },
        ],
        '.copilot/session-state',
      );

      expect(paths).toContain(join(work, '.copilot/session-state'));
      expect(paths).toContain(join(personal, '.copilot/session-state'));
    });

    it('skips secondary accounts whose dir does not exist on disk', () => {
      const real = join(tmpDir, 'real');
      const missing = join(tmpDir, 'missing');
      mkdirSync(join(real, '.gemini', 'tmp'), { recursive: true });
      // Do not create `missing/.gemini/tmp`

      const registry = new AccountProviderRegistry();
      const manager = new AccountHomeManager(registry);
      const paths = manager.listAllAccountPaths(
        [
          { accountId: 'real', name: 'Real', isDefault: false, homeDir: real, createdAt: '2026-01-01', lastUsedAt: null },
          { accountId: 'missing', name: 'Missing', isDefault: false, homeDir: missing, createdAt: '2026-01-01', lastUsedAt: null },
        ],
        '.gemini/tmp',
      );

      expect(paths).toContain(join(real, '.gemini/tmp'));
      expect(paths.some((p) => p.startsWith(missing))).toBe(false);
    });

    it('ignores default account (has no homeDir) without throwing', () => {
      const registry = new AccountProviderRegistry();
      const manager = new AccountHomeManager(registry);
      // Should not throw when only the default account is present
      const paths = manager.listAllAccountPaths(
        [{ accountId: 'default', name: 'Default', isDefault: true, homeDir: null, createdAt: '2026-01-01', lastUsedAt: null }],
        '.codex/sessions',
      );
      // May be empty if homedir()/.codex/sessions doesn't exist, or may have one entry.
      // What matters: no exception and no fake/nonexistent paths.
      for (const p of paths) {
        expect(existsSync(p)).toBe(true);
      }
    });

    it('deduplicates when a secondary dir equals the default', () => {
      const real = join(tmpDir, 'real');
      mkdirSync(join(real, '.x'), { recursive: true });

      const registry = new AccountProviderRegistry();
      const manager = new AccountHomeManager(registry);
      // Two secondaries pointing at the same homeDir → one entry, not two
      const paths = manager.listAllAccountPaths(
        [
          { accountId: 'a', name: 'A', isDefault: false, homeDir: real, createdAt: '2026-01-01', lastUsedAt: null },
          { accountId: 'b', name: 'B', isDefault: false, homeDir: real, createdAt: '2026-01-01', lastUsedAt: null },
        ],
        '.x',
      );
      const matches = paths.filter((p) => p === join(real, '.x'));
      expect(matches).toHaveLength(1);
    });
  });

  describe('syncSymlinks — symlink-to-directory migration', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = join(tmpdir(), `ahm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('converts provider config symlink to real directory', () => {
      // Simulate existing account home where .codex is a symlink (pre-migration state)
      const accountHome = join(tmpDir, 'account');
      mkdirSync(accountHome, { recursive: true });

      // Create a source dir to symlink to (simulates real ~/.codex)
      const sourceDir = join(tmpDir, 'source-codex');
      mkdirSync(sourceDir, { recursive: true });
      symlinkSync(sourceDir, join(accountHome, '.codex'));

      // Verify it's a symlink before migration
      expect(lstatSync(join(accountHome, '.codex')).isSymbolicLink()).toBe(true);

      const registry = new AccountProviderRegistry();
      registry.register(createMockAdapter({ sessionType: 'codex', getConfigDirName: () => '.codex', getSharedConfigSubdirs: () => [] }));
      const manager = new AccountHomeManager(registry);

      manager.syncSymlinks({
        accountId: 'test',
        name: 'Test',
        isDefault: false,
        homeDir: accountHome,
        createdAt: '2026-01-01',
        lastUsedAt: null,
      });

      // After migration: .codex should be a real directory, not a symlink
      expect(existsSync(join(accountHome, '.codex'))).toBe(true);
      expect(lstatSync(join(accountHome, '.codex')).isSymbolicLink()).toBe(false);
      expect(lstatSync(join(accountHome, '.codex')).isDirectory()).toBe(true);
    });

    it('leaves existing real directories untouched', () => {
      const accountHome = join(tmpDir, 'account');
      mkdirSync(join(accountHome, '.codex'), { recursive: true });

      const registry = new AccountProviderRegistry();
      registry.register(createMockAdapter({ sessionType: 'codex', getConfigDirName: () => '.codex', getSharedConfigSubdirs: () => [] }));
      const manager = new AccountHomeManager(registry);

      manager.syncSymlinks({
        accountId: 'test',
        name: 'Test',
        isDefault: false,
        homeDir: accountHome,
        createdAt: '2026-01-01',
        lastUsedAt: null,
      });

      // Should still be a real directory
      expect(lstatSync(join(accountHome, '.codex')).isDirectory()).toBe(true);
      expect(lstatSync(join(accountHome, '.codex')).isSymbolicLink()).toBe(false);
    });

    it('skips default accounts', () => {
      const registry = new AccountProviderRegistry();
      registry.register(createMockAdapter({ sessionType: 'codex', getConfigDirName: () => '.codex' }));
      const manager = new AccountHomeManager(registry);

      // Should not throw for default account (no-op)
      manager.syncSymlinks({
        accountId: 'default',
        name: 'Default',
        isDefault: true,
        homeDir: null,
        createdAt: '2026-01-01',
        lastUsedAt: null,
      });
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
