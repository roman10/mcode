import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHookBridge, type HookBridgeDescriptor } from '../../../src/main/hooks/hook-bridge';

interface TestConfig {
  hooks?: Record<string, { command: string }[]>;
  other?: string;
}

let tempDir: string;
let bridgeScriptPath: string;
let configPath: string;

function createTestDescriptor(overrides?: Partial<HookBridgeDescriptor<TestConfig>>): HookBridgeDescriptor<TestConfig> {
  return {
    agentName: 'test-agent',
    agentTag: 'test-agent-hook-config',
    configPath: () => configPath,
    bridgeScriptPath: () => bridgeScriptPath,
    bridgeScriptContent: () => '#!/bin/sh\necho "test bridge"',
    removeHooks: (config) => {
      const result = { ...config };
      if (!result.hooks) return result;
      const newHooks: Record<string, { command: string }[]> = {};
      for (const [event, entries] of Object.entries(result.hooks)) {
        const filtered = entries.filter((e) => !e.command.includes('test-hook-bridge.sh'));
        if (filtered.length > 0) newHooks[event] = filtered;
      }
      result.hooks = Object.keys(newHooks).length > 0 ? newHooks : undefined;
      return result;
    },
    mergeHooks: (config) => {
      // First remove, then add
      const result = createTestDescriptor().removeHooks(config);
      const hooks = result.hooks ?? {};
      hooks['TestEvent'] = [...(hooks['TestEvent'] ?? []), { command: bridgeScriptPath }];
      result.hooks = hooks;
      return result;
    },
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'hook-bridge-test-'));
  bridgeScriptPath = join(tempDir, 'test-hook-bridge.sh');
  configPath = join(tempDir, 'hooks.json');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('writeBridgeScript', () => {
  it('writes script file with correct content and permissions', () => {
    const bridge = createHookBridge(createTestDescriptor());
    const result = bridge.writeBridgeScript();

    expect(result).toBe(bridgeScriptPath);
    expect(existsSync(bridgeScriptPath)).toBe(true);
    expect(readFileSync(bridgeScriptPath, 'utf-8')).toBe('#!/bin/sh\necho "test bridge"');

    const mode = statSync(bridgeScriptPath).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it('creates parent directories', () => {
    bridgeScriptPath = join(tempDir, 'nested', 'dir', 'test-hook-bridge.sh');
    const bridge = createHookBridge(createTestDescriptor());
    bridge.writeBridgeScript();
    expect(existsSync(bridgeScriptPath)).toBe(true);
  });
});

describe('reconcile', () => {
  it('skips with no error when bridge script does not exist', () => {
    const bridge = createHookBridge(createTestDescriptor());
    // bridge script not written — should skip
    expect(() => bridge.reconcile()).not.toThrow();
    expect(existsSync(configPath)).toBe(false);
  });

  it('creates config from empty when file does not exist', () => {
    const bridge = createHookBridge(createTestDescriptor());
    bridge.writeBridgeScript();
    bridge.reconcile();

    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as TestConfig;
    expect(config.hooks?.TestEvent).toHaveLength(1);
    expect(config.hooks?.TestEvent?.[0].command).toBe(bridgeScriptPath);
  });

  it('preserves existing user hooks', () => {
    const bridge = createHookBridge(createTestDescriptor());
    bridge.writeBridgeScript();

    writeFileSync(configPath, JSON.stringify({
      hooks: { TestEvent: [{ command: 'user-hook.sh' }] },
      other: 'preserved',
    }));

    bridge.reconcile();

    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as TestConfig;
    expect(config.hooks?.TestEvent).toHaveLength(2);
    expect(config.hooks?.TestEvent?.[0].command).toBe('user-hook.sh');
    expect(config.hooks?.TestEvent?.[1].command).toBe(bridgeScriptPath);
    expect(config.other).toBe('preserved');
  });

  it('creates one-time backup', () => {
    const bridge = createHookBridge(createTestDescriptor());
    bridge.writeBridgeScript();

    writeFileSync(configPath, '{"original": true}');
    bridge.reconcile();

    const backupPath = configPath + '.mcode.bak';
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, 'utf-8')).toBe('{"original": true}');
  });

  it('does not overwrite existing backup on subsequent reconcile', () => {
    const bridge = createHookBridge(createTestDescriptor());
    bridge.writeBridgeScript();

    writeFileSync(configPath, '{"first": true}');
    bridge.reconcile();

    // Modify config and reconcile again
    writeFileSync(configPath, '{"second": true}');
    bridge.reconcile();

    const backupContent = readFileSync(configPath + '.mcode.bak', 'utf-8');
    expect(backupContent).toBe('{"first": true}');
  });

  it('throws on invalid JSON in config file', () => {
    const bridge = createHookBridge(createTestDescriptor());
    bridge.writeBridgeScript();
    writeFileSync(configPath, 'not json');

    expect(() => bridge.reconcile()).toThrow(/Invalid JSON/);
  });
});

describe('cleanup', () => {
  it('removes mcode hooks from config', () => {
    const bridge = createHookBridge(createTestDescriptor());
    bridge.writeBridgeScript();
    bridge.reconcile();

    // Add a user hook alongside
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as TestConfig;
    config.hooks!.TestEvent = [
      { command: 'user-hook.sh' },
      ...config.hooks!.TestEvent!,
    ];
    writeFileSync(configPath, JSON.stringify(config));

    bridge.cleanup();

    const cleaned = JSON.parse(readFileSync(configPath, 'utf-8')) as TestConfig;
    expect(cleaned.hooks?.TestEvent).toHaveLength(1);
    expect(cleaned.hooks?.TestEvent?.[0].command).toBe('user-hook.sh');
  });

  it('does not throw when config file does not exist', () => {
    const bridge = createHookBridge(createTestDescriptor());
    expect(() => bridge.cleanup()).not.toThrow();
  });
});

describe('full lifecycle', () => {
  it('write → reconcile → cleanup round-trip', () => {
    const bridge = createHookBridge(createTestDescriptor());

    // Write bridge script
    bridge.writeBridgeScript();
    expect(existsSync(bridgeScriptPath)).toBe(true);

    // Reconcile creates config with mcode hooks
    bridge.reconcile();
    const after = JSON.parse(readFileSync(configPath, 'utf-8')) as TestConfig;
    expect(after.hooks?.TestEvent).toHaveLength(1);

    // Cleanup removes mcode hooks
    bridge.cleanup();
    const cleaned = JSON.parse(readFileSync(configPath, 'utf-8')) as TestConfig;
    expect(cleaned.hooks).toBeUndefined();
  });

  it('exposes agentName from descriptor', () => {
    const bridge = createHookBridge(createTestDescriptor());
    expect(bridge.agentName).toBe('test-agent');
  });
});
