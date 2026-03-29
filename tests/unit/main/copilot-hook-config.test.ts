import { describe, it, expect } from 'vitest';
import {
  removeMcodeBridgeHooks,
  mergeMcodeBridgeHooks,
} from '../../../src/main/hooks/copilot-hook-config';

// --- Pure function tests (no file I/O) ---

describe('removeMcodeBridgeHooks', () => {
  it('returns unchanged config when no hooks present', () => {
    const config = { version: 1 };
    const result = removeMcodeBridgeHooks(config);
    expect(result).toEqual(config);
  });

  it('removes mcode bridge hooks', () => {
    const config = {
      version: 1,
      hooks: {
        sessionStart: [
          { type: 'command', bash: '/Users/test/.mcode/copilot-hook-bridge.sh', timeoutSec: 10, env: { COPILOT_HOOK_EVENT: 'sessionStart' } },
        ],
      },
    };
    const result = removeMcodeBridgeHooks(config);
    expect(result.hooks).toBeUndefined();
  });

  it('preserves user-defined hooks', () => {
    const config = {
      version: 1,
      hooks: {
        preToolUse: [
          { type: 'command', bash: 'python3 my_hook.py', timeoutSec: 5 },
          { type: 'command', bash: '/Users/test/.mcode/copilot-hook-bridge.sh', timeoutSec: 10, env: { COPILOT_HOOK_EVENT: 'preToolUse' } },
        ],
        sessionEnd: [
          { type: 'command', bash: '/Users/test/.mcode/copilot-hook-bridge.sh', timeoutSec: 10, env: { COPILOT_HOOK_EVENT: 'sessionEnd' } },
        ],
      },
    };
    const result = removeMcodeBridgeHooks(config);
    expect(result.hooks).toBeDefined();
    expect(result.hooks!['preToolUse']).toHaveLength(1);
    expect(result.hooks!['preToolUse'][0].bash).toBe('python3 my_hook.py');
    // sessionEnd was mcode-only, so entirely removed
    expect(result.hooks!['sessionEnd']).toBeUndefined();
  });
});

describe('mergeMcodeBridgeHooks', () => {
  const ALL_EVENTS = ['sessionStart', 'sessionEnd', 'preToolUse', 'postToolUse', 'userPromptSubmitted', 'errorOccurred'];

  it('adds bridge hooks for all events to empty config', () => {
    const result = mergeMcodeBridgeHooks({});
    expect(result.version).toBe(1);
    expect(result.hooks).toBeDefined();

    for (const event of ALL_EVENTS) {
      expect(result.hooks![event]).toBeDefined();
      expect(result.hooks![event]).toHaveLength(1);
      const entry = result.hooks![event][0];
      expect(entry.type).toBe('command');
      expect(entry.bash).toContain('copilot-hook-bridge.sh');
      expect(entry.timeoutSec).toBe(10);
      expect(entry.env).toEqual({ COPILOT_HOOK_EVENT: event });
    }
  });

  it('preserves existing version', () => {
    const result = mergeMcodeBridgeHooks({ version: 1 });
    expect(result.version).toBe(1);
  });

  it('preserves existing user hooks and appends mcode hooks after', () => {
    const config = {
      version: 1,
      hooks: {
        preToolUse: [
          { type: 'command', bash: 'my-custom-hook.sh', timeoutSec: 5 },
        ],
      },
    };
    const result = mergeMcodeBridgeHooks(config);
    // User hook preserved + mcode hook appended
    expect(result.hooks!['preToolUse']).toHaveLength(2);
    expect(result.hooks!['preToolUse'][0].bash).toBe('my-custom-hook.sh');
    expect(result.hooks!['preToolUse'][1].bash).toContain('copilot-hook-bridge.sh');
  });

  it('replaces existing mcode hooks (no duplicates)', () => {
    const config = {
      version: 1,
      hooks: {
        preToolUse: [
          { type: 'command', bash: '/old/path/.mcode/copilot-hook-bridge.sh', timeoutSec: 5, env: { COPILOT_HOOK_EVENT: 'preToolUse' } },
        ],
      },
    };
    const result = mergeMcodeBridgeHooks(config);
    // Old mcode hook removed, new one added
    expect(result.hooks!['preToolUse']).toHaveLength(1);
    expect(result.hooks!['preToolUse'][0].timeoutSec).toBe(10);
  });

  it('is idempotent', () => {
    const first = mergeMcodeBridgeHooks({});
    const second = mergeMcodeBridgeHooks(first);
    expect(second).toEqual(first);
  });

  it('round-trip: merge then remove leaves no mcode hooks', () => {
    const original = {
      version: 1,
      hooks: {
        preToolUse: [
          { type: 'command', bash: 'user-hook.sh', timeoutSec: 3 },
        ],
      },
    };
    const merged = mergeMcodeBridgeHooks(original);
    const cleaned = removeMcodeBridgeHooks(merged);

    // Only user hook remains
    expect(cleaned.hooks!['preToolUse']).toHaveLength(1);
    expect(cleaned.hooks!['preToolUse'][0].bash).toBe('user-hook.sh');
    // mcode-only events fully removed
    expect(cleaned.hooks!['sessionStart']).toBeUndefined();
    expect(cleaned.hooks!['errorOccurred']).toBeUndefined();
  });
});
