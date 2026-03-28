import { describe, it, expect } from 'vitest';
import {
  removeMcodeBridgeHooks,
  mergeMcodeBridgeHooks,
} from '../../../src/main/hooks/codex-hook-config';

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
        PreToolUse: [
          {
            hooks: [
              { type: 'command', command: '/Users/test/.mcode/codex-hook-bridge.sh', timeout: 10 },
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
        PreToolUse: [
          {
            matcher: '^Bash$',
            hooks: [
              { type: 'command', command: 'python3 my_hook.py', timeout: 5 },
              { type: 'command', command: '/Users/test/.mcode/codex-hook-bridge.sh', timeout: 10 },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              { type: 'command', command: '/Users/test/.mcode/codex-hook-bridge.sh', timeout: 10 },
            ],
          },
        ],
      },
    };
    const result = removeMcodeBridgeHooks(config);
    expect(result.hooks).toBeDefined();
    expect(result.hooks!['PreToolUse']).toHaveLength(1);
    expect(result.hooks!['PreToolUse'][0].hooks).toHaveLength(1);
    expect(result.hooks!['PreToolUse'][0].hooks[0].command).toBe('python3 my_hook.py');
    // Stop group was mcode-only, so entirely removed
    expect(result.hooks!['Stop']).toBeUndefined();
  });
});

describe('mergeMcodeBridgeHooks', () => {
  it('adds bridge hooks for all events to empty config', () => {
    const result = mergeMcodeBridgeHooks({});
    expect(result.hooks).toBeDefined();

    const events = ['SessionStart', 'SessionEnd', 'PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit', 'Notification'];
    for (const event of events) {
      expect(result.hooks![event]).toBeDefined();
      expect(result.hooks![event]).toHaveLength(1);
      const group = result.hooks![event][0];
      expect(group.hooks).toHaveLength(1);
      expect(group.hooks[0].type).toBe('command');
      expect(group.hooks[0].command).toContain('codex-hook-bridge.sh');
      expect(group.hooks[0].timeout).toBe(10);
    }
  });

  it('preserves existing user hooks', () => {
    const config = {
      hooks: {
        PreToolUse: [
          {
            matcher: '^Bash$',
            hooks: [{ type: 'command', command: 'my-custom-hook.sh' }],
          },
        ],
      },
    };
    const result = mergeMcodeBridgeHooks(config);
    // User hook preserved + mcode hook added
    expect(result.hooks!['PreToolUse']).toHaveLength(2);
    expect(result.hooks!['PreToolUse'][0].hooks[0].command).toBe('my-custom-hook.sh');
    expect(result.hooks!['PreToolUse'][1].hooks[0].command).toContain('codex-hook-bridge.sh');
  });

  it('replaces existing mcode hooks (no duplicates)', () => {
    const config = {
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: 'command', command: '/old/path/.mcode/codex-hook-bridge.sh', timeout: 5 }],
          },
        ],
      },
    };
    const result = mergeMcodeBridgeHooks(config);
    // Old mcode hook removed, new one added
    expect(result.hooks!['PreToolUse']).toHaveLength(1);
    expect(result.hooks!['PreToolUse'][0].hooks[0].timeout).toBe(10);
  });

  it('round-trip: merge then remove leaves no mcode hooks', () => {
    const original = {
      hooks: {
        PreToolUse: [
          {
            matcher: '^Bash$',
            hooks: [{ type: 'command', command: 'user-hook.sh' }],
          },
        ],
      },
    };
    const merged = mergeMcodeBridgeHooks(original);
    const cleaned = removeMcodeBridgeHooks(merged);

    // Only user hook remains
    expect(cleaned.hooks!['PreToolUse']).toHaveLength(1);
    expect(cleaned.hooks!['PreToolUse'][0].hooks[0].command).toBe('user-hook.sh');
    // mcode-only events fully removed
    expect(cleaned.hooks!['SessionStart']).toBeUndefined();
    expect(cleaned.hooks!['Stop']).toBeUndefined();
  });
});
