import { describe, it, expect } from 'vitest';
import {
  claudePollState,
  createClaudeRuntimeAdapter,
} from '../../../src/main/session/agent-runtimes/claude-runtime';
import type { PtyPollContext } from '../../../src/main/session/agent-runtime';

function ctx(overrides: Partial<PtyPollContext> = {}): PtyPollContext {
  return {
    sessionId: 'test-session',
    status: 'active',
    attentionLevel: 'none',
    lastTool: null,
    buffer: '',
    lastDataAt: Date.now(),
    isQuiescent: false,
    hasPendingTasks: false,
    ...overrides,
  };
}

describe('claudePollState', () => {
  describe('permission prompt detection', () => {
    const permissionBuffer = 'some output\nAllow once\nDeny once\nAllow always\n';

    it('detects permission prompt when active and quiescent', () => {
      const result = claudePollState(ctx({
        status: 'active',
        buffer: permissionBuffer,
        isQuiescent: true,
      }));
      expect(result).toEqual({
        status: 'waiting',
        attention: { level: 'action', reason: 'Permission prompt detected' },
      });
    });

    it('detects permission prompt when idle and quiescent', () => {
      const result = claudePollState(ctx({
        status: 'idle',
        buffer: permissionBuffer,
        isQuiescent: true,
      }));
      expect(result).toEqual({
        status: 'waiting',
        attention: { level: 'action', reason: 'Permission prompt detected' },
      });
    });

    it('skips permission detection when already action attention', () => {
      const result = claudePollState(ctx({
        status: 'active',
        attentionLevel: 'action',
        buffer: permissionBuffer,
        isQuiescent: true,
      }));
      // Should not re-trigger permission detection — falls through to other checks
      expect(result?.status).not.toBe('waiting');
    });

    it('skips permission detection when not quiescent', () => {
      const result = claudePollState(ctx({
        status: 'active',
        buffer: permissionBuffer,
        isQuiescent: false,
      }));
      expect(result).toBeNull();
    });

    it('matches Allow once with whitespace variations', () => {
      const result = claudePollState(ctx({
        status: 'active',
        buffer: 'Allow  once',
        isQuiescent: true,
      }));
      expect(result?.status).toBe('waiting');
    });
  });

  describe('user-choice menu detection', () => {
    const userChoiceBuffer = '❯ 1. Yes, and bypass permissions\n  2. Yes, manually approve\n  3. Type here\n';

    it('detects user-choice menu when quiescent', () => {
      const result = claudePollState(ctx({
        status: 'active',
        buffer: userChoiceBuffer,
        isQuiescent: true,
      }));
      expect(result).toEqual({
        status: 'waiting',
        attention: { level: 'action', reason: 'Waiting for your response' },
      });
    });

    it('detects user-choice menu when lastTool is ExitPlanMode even without quiescence', () => {
      const result = claudePollState(ctx({
        status: 'active',
        buffer: userChoiceBuffer,
        lastTool: 'ExitPlanMode',
        isQuiescent: false,
      }));
      expect(result).toEqual({
        status: 'waiting',
        attention: { level: 'action', reason: 'Waiting for your response' },
      });
    });

    it('detects user-choice menu when lastTool is AskUserQuestion', () => {
      const result = claudePollState(ctx({
        status: 'idle',
        buffer: userChoiceBuffer,
        lastTool: 'AskUserQuestion',
        isQuiescent: false,
      }));
      expect(result).toEqual({
        status: 'waiting',
        attention: { level: 'action', reason: 'Waiting for your response' },
      });
    });

    it('skips when already action attention', () => {
      const result = claudePollState(ctx({
        status: 'active',
        attentionLevel: 'action',
        buffer: userChoiceBuffer,
        isQuiescent: true,
      }));
      // Should not detect user choice when already action attention
      expect(result?.attention?.reason).not.toBe('Waiting for your response');
    });
  });

  describe('idle prompt detection', () => {
    const idleBuffer = 'some output\n❯ ';

    it('detects idle prompt when active and quiescent', () => {
      const result = claudePollState(ctx({
        status: 'active',
        buffer: idleBuffer,
        isQuiescent: true,
      }));
      expect(result).toEqual({
        status: 'idle',
        attention: { level: 'action', reason: 'Claude finished — awaiting next input' },
      });
    });

    it('detects idle prompt when waiting (fallback recovery)', () => {
      const result = claudePollState(ctx({
        status: 'waiting',
        buffer: idleBuffer,
        isQuiescent: true,
      }));
      expect(result).toEqual({
        status: 'idle',
        attention: { level: 'action', reason: 'Claude finished — awaiting next input' },
      });
    });

    it('returns idle without attention when pending tasks exist', () => {
      const result = claudePollState(ctx({
        status: 'active',
        buffer: idleBuffer,
        isQuiescent: true,
        hasPendingTasks: true,
      }));
      expect(result).toEqual({ status: 'idle' });
    });

    it('does not detect idle when not quiescent', () => {
      const result = claudePollState(ctx({
        status: 'active',
        buffer: idleBuffer,
        isQuiescent: false,
      }));
      expect(result).toBeNull();
    });

    it('does not confuse user-choice menu with idle prompt', () => {
      const menuBuffer = '❯ 1. Option one\n  2. Option two\n';
      const result = claudePollState(ctx({
        status: 'active',
        buffer: menuBuffer,
        isQuiescent: true,
      }));
      // Should detect as user-choice, not idle prompt
      expect(result?.status).toBe('waiting');
    });
  });

  describe('no transition', () => {
    it('returns null for idle status without prompt pattern', () => {
      const result = claudePollState(ctx({
        status: 'idle',
        buffer: 'no prompt here',
        isQuiescent: true,
      }));
      expect(result).toBeNull();
    });

    it('returns null for active status without quiescence or patterns', () => {
      const result = claudePollState(ctx({
        status: 'active',
        buffer: 'agent working...',
        isQuiescent: false,
      }));
      expect(result).toBeNull();
    });

    it('returns null for ended status', () => {
      const result = claudePollState(ctx({
        status: 'ended',
        buffer: '❯ ',
        isQuiescent: true,
      }));
      // ended sessions shouldn't reach pollState, but if they do, no transition
      expect(result).toBeNull();
    });
  });
});

describe('createClaudeRuntimeAdapter', () => {
  it('creates an adapter with sessionType claude and pollState', () => {
    const adapter = createClaudeRuntimeAdapter();
    expect(adapter.sessionType).toBe('claude');
    expect(adapter.pollState).toBe(claudePollState);
    expect(adapter.afterCreate).toBeUndefined();
    expect(adapter.prepareResume).toBeUndefined();
  });
});
