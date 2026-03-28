import { describe, it, expect } from 'vitest';
import {
  removeMcodeBridgeHooks,
  mergeMcodeBridgeHooks,
} from '../../../src/main/hooks/gemini-hook-config';

// --- Pure function tests (no file I/O) ---

describe('removeMcodeBridgeHooks', () => {
  it('returns unchanged config when no hooks present', () => {
    const config = { someKey: 'value' };
    const result = removeMcodeBridgeHooks(config);
    expect(result).toEqual(config);
  });

  it('removes mcode bridge hooks', () => {
    const config = {
      hooks: {
        BeforeTool: [
          {
            matcher: '*',
            hooks: [
              { type: 'command', command: '/Users/test/.mcode/gemini-hook-bridge.sh', name: 'mcode-bridge', timeout: 10000 },
            ],
          },
        ],
      },
    };
    const result = removeMcodeBridgeHooks(config);
    expect(result.hooks).toBeUndefined();
  });

  it('preserves user-defined hooks', () => {
    const config = {
      hooks: {
        BeforeTool: [
          {
            matcher: 'write_file|replace',
            hooks: [
              { type: 'command', command: 'python3 my_hook.py', timeout: 5000 },
              { type: 'command', command: '/Users/test/.mcode/gemini-hook-bridge.sh', name: 'mcode-bridge', timeout: 10000 },
            ],
          },
        ],
        AfterAgent: [
          {
            matcher: '*',
            hooks: [
              { type: 'command', command: '/Users/test/.mcode/gemini-hook-bridge.sh', name: 'mcode-bridge', timeout: 10000 },
            ],
          },
        ],
      },
    };
    const result = removeMcodeBridgeHooks(config);
    expect(result.hooks).toBeDefined();
    expect(result.hooks!['BeforeTool']).toHaveLength(1);
    expect(result.hooks!['BeforeTool'][0].hooks).toHaveLength(1);
    expect(result.hooks!['BeforeTool'][0].hooks[0].command).toBe('python3 my_hook.py');
    // AfterAgent group was mcode-only, so entirely removed
    expect(result.hooks!['AfterAgent']).toBeUndefined();
  });
});

describe('mergeMcodeBridgeHooks', () => {
  it('adds bridge hooks for all 7 events to empty config', () => {
    const result = mergeMcodeBridgeHooks({});
    expect(result.hooks).toBeDefined();

    const events = ['SessionStart', 'SessionEnd', 'BeforeTool', 'AfterTool', 'AfterAgent', 'BeforeAgent', 'Notification'];
    for (const event of events) {
      expect(result.hooks![event]).toBeDefined();
      expect(result.hooks![event]).toHaveLength(1);
      const group = result.hooks![event][0];
      expect(group.matcher).toBe('*');
      expect(group.hooks).toHaveLength(1);
      expect(group.hooks[0].type).toBe('command');
      expect(group.hooks[0].command).toContain('gemini-hook-bridge.sh');
      expect(group.hooks[0].name).toBe('mcode-bridge');
      expect(group.hooks[0].timeout).toBe(10000);
    }
  });

  it('preserves existing user hooks', () => {
    const config = {
      hooks: {
        BeforeTool: [
          {
            matcher: 'write_file',
            hooks: [{ type: 'command', command: 'my-custom-hook.sh' }],
          },
        ],
      },
    };
    const result = mergeMcodeBridgeHooks(config);
    // User hook preserved + mcode hook added
    expect(result.hooks!['BeforeTool']).toHaveLength(2);
    expect(result.hooks!['BeforeTool'][0].hooks[0].command).toBe('my-custom-hook.sh');
    expect(result.hooks!['BeforeTool'][1].hooks[0].command).toContain('gemini-hook-bridge.sh');
  });

  it('replaces existing mcode hooks (no duplicates)', () => {
    const config = {
      hooks: {
        BeforeTool: [
          {
            matcher: '*',
            hooks: [{ type: 'command', command: '/old/path/.mcode/gemini-hook-bridge.sh', name: 'mcode-bridge', timeout: 5000 }],
          },
        ],
      },
    };
    const result = mergeMcodeBridgeHooks(config);
    // Old mcode hook removed, new one added
    expect(result.hooks!['BeforeTool']).toHaveLength(1);
    expect(result.hooks!['BeforeTool'][0].hooks[0].timeout).toBe(10000);
  });

  it('does not touch non-hooks settings', () => {
    const config = {
      hooksConfig: { enabled: true },
      theme: 'dark',
      someOtherSetting: 42,
    };
    const result = mergeMcodeBridgeHooks(config);
    expect(result.hooksConfig).toEqual({ enabled: true });
    expect(result.theme).toBe('dark');
    expect(result.someOtherSetting).toBe(42);
  });

  it('round-trip: merge then remove leaves no mcode hooks', () => {
    const original = {
      hooks: {
        BeforeTool: [
          {
            matcher: 'write_file',
            hooks: [{ type: 'command', command: 'user-hook.sh' }],
          },
        ],
      },
    };
    const merged = mergeMcodeBridgeHooks(original);
    const cleaned = removeMcodeBridgeHooks(merged);

    // Only user hook remains
    expect(cleaned.hooks!['BeforeTool']).toHaveLength(1);
    expect(cleaned.hooks!['BeforeTool'][0].hooks[0].command).toBe('user-hook.sh');
    // mcode-only events fully removed
    expect(cleaned.hooks!['SessionStart']).toBeUndefined();
    expect(cleaned.hooks!['AfterAgent']).toBeUndefined();
  });
});
