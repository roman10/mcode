import { describe, it, expect } from 'vitest';
import { AccountProviderRegistry } from '../../../../src/main/accounts/account-provider';
import type { AccountProviderAdapter } from '../../../../src/main/accounts/account-provider';

function createMockAdapter(overrides: Partial<AccountProviderAdapter> = {}): AccountProviderAdapter {
  return {
    sessionType: 'claude',
    supportsAccountProfiles: true,
    getConfigDirName: () => '.claude',
    getConfigEnv: () => ({}),
    getSharedConfigSubdirs: () => [],
    checkCliInstalled: async () => 'ok',
    checkAuthStatus: async () => ({ status: 'ok' }),
    buildAuthTerminalInput: () => null,
    getInstallHelpUrl: () => undefined,
    supportsSubscriptionUsage: () => false,
    getSubscriptionUsage: async () => null,
    ...overrides,
  };
}

describe('AccountProviderRegistry', () => {
  it('registers and retrieves an adapter', () => {
    const registry = new AccountProviderRegistry();
    const adapter = createMockAdapter({ sessionType: 'claude' });
    registry.register(adapter);

    expect(registry.get('claude')).toBe(adapter);
  });

  it('returns undefined for unregistered type', () => {
    const registry = new AccountProviderRegistry();
    expect(registry.get('copilot')).toBeUndefined();
  });

  it('getAllConfigDirNames returns all registered config dir names', () => {
    const registry = new AccountProviderRegistry();
    registry.register(createMockAdapter({ sessionType: 'claude', getConfigDirName: () => '.claude' }));
    registry.register(createMockAdapter({ sessionType: 'copilot', getConfigDirName: () => '.copilot' }));

    const names = registry.getAllConfigDirNames();
    expect(names).toEqual(new Set(['.claude', '.copilot']));
  });

  it('getAllConfigDirNames returns empty set when no adapters registered', () => {
    const registry = new AccountProviderRegistry();
    expect(registry.getAllConfigDirNames()).toEqual(new Set());
  });

  it('getRegistered returns all registered adapters', () => {
    const registry = new AccountProviderRegistry();
    const claude = createMockAdapter({ sessionType: 'claude' });
    const copilot = createMockAdapter({ sessionType: 'copilot' });
    registry.register(claude);
    registry.register(copilot);

    const registered = registry.getRegistered();
    expect(registered).toHaveLength(2);
    expect(registered).toContain(claude);
    expect(registered).toContain(copilot);
  });

  it('last registration wins for same session type', () => {
    const registry = new AccountProviderRegistry();
    const first = createMockAdapter({ sessionType: 'claude', getConfigDirName: () => '.claude-old' });
    const second = createMockAdapter({ sessionType: 'claude', getConfigDirName: () => '.claude-new' });
    registry.register(first);
    registry.register(second);

    expect(registry.get('claude')).toBe(second);
    expect(registry.getRegistered()).toHaveLength(1);
  });
});
