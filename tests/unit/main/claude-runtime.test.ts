import { describe, it, expect } from 'vitest';
import {
  claudePollState,
  createClaudeRuntimeAdapter,
  isClaudeCommand,
  buildClaudeResumePlan,
  buildClaudeCreatePlan,
} from '../../../src/main/session/agent-runtimes/claude-runtime';
import type {
  AgentCreateContext,
  AgentPrepareResumeContext,
  AgentResumeRow,
  PtyPollContext,
} from '../../../src/main/session/agent-runtime';
import type { HookRuntimeInfo } from '../../../src/shared/types';

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
  it('creates an adapter with sessionType claude, pollState, prepareCreate, and prepareResume', () => {
    const adapter = createClaudeRuntimeAdapter();
    expect(adapter.sessionType).toBe('claude');
    expect(adapter.pollState).toBe(claudePollState);
    expect(adapter.afterCreate).toBeUndefined();
    expect(adapter.prepareResume).toBeDefined();
    expect(adapter.prepareCreate).toBeDefined();
  });
});

describe('isClaudeCommand', () => {
  it('recognizes standard claude binary names', () => {
    expect(isClaudeCommand('claude')).toBe(true);
    expect(isClaudeCommand('/usr/local/bin/claude')).toBe(true);
    expect(isClaudeCommand('claude.exe')).toBe(true);
    expect(isClaudeCommand('claude.cmd')).toBe(true);
  });
  it('rejects non-claude binaries', () => {
    expect(isClaudeCommand('codex')).toBe(false);
    expect(isClaudeCommand('/usr/local/bin/node')).toBe(false);
  });
});

describe('buildClaudeResumePlan', () => {
  function makeRow(overrides: Partial<AgentResumeRow> = {}): AgentResumeRow {
    return {
      command: 'claude',
      cwd: '/tmp/project',
      codexThreadId: null,
      geminiSessionId: null,
      claudeSessionId: 'session-abc',
      permissionMode: null,
      effort: null,
      enableAutoMode: false,
      allowBypassPermissions: false,
      worktree: null,
      ...overrides,
    };
  }

  function makeHook(state: HookRuntimeInfo['state'] = 'ready'): HookRuntimeInfo {
    return { state, port: 9999, warning: null };
  }

  function makeCtx(overrides: {
    row?: Partial<AgentResumeRow>;
    hookState?: HookRuntimeInfo['state'];
  } = {}): AgentPrepareResumeContext {
    return {
      sessionId: 'test-session',
      row: makeRow(overrides.row),
      hookRuntime: makeHook(overrides.hookState),
      codexBridgeReady: false,
    };
  }

  it('basic resume with all args', () => {
    const result = buildClaudeResumePlan(makeCtx({
      row: {
        claudeSessionId: 'session-abc',
        permissionMode: 'auto',
        effort: 'high',
        enableAutoMode: true,
        allowBypassPermissions: true,
        worktree: null,
        cwd: '/tmp/project',
        command: 'claude',
      },
      hookState: 'ready',
    }));
    expect(result).toEqual({
      command: 'claude',
      cwd: '/tmp/project',
      args: [
        '--resume', 'session-abc',
        '--permission-mode', 'auto',
        '--effort', 'high',
        '--enable-auto-mode',
        '--allow-dangerously-skip-permissions',
      ],
      env: {},
      hookMode: 'live',
      logLabel: 'Claude',
      logContext: {
        claudeSessionId: 'session-abc',
        cwd: '/tmp/project',
        worktree: null,
        hookMode: 'live',
      },
    });
  });

  it('throws when claudeSessionId is null', () => {
    expect(() =>
      buildClaudeResumePlan(makeCtx({ row: { claudeSessionId: null } })),
    ).toThrow('Cannot resume: no Claude session ID recorded');
  });

  it('resolves worktree cwd', () => {
    const result = buildClaudeResumePlan(
      makeCtx({ row: { worktree: 'my-worktree', cwd: '/tmp/project', claudeSessionId: 's1' } }),
      { existsSync: () => true },
    );
    expect(result.cwd).toBe('/tmp/project/.claude/worktrees/my-worktree');
  });

  it('throws when worktree dir does not exist', () => {
    expect(() =>
      buildClaudeResumePlan(
        makeCtx({ row: { worktree: 'my-worktree', cwd: '/tmp/project', claudeSessionId: 's1' } }),
        { existsSync: () => false },
      ),
    ).toThrow('Worktree directory no longer exists');
  });

  it('throws when worktree is empty string', () => {
    expect(() =>
      buildClaudeResumePlan(makeCtx({ row: { worktree: '' } })),
    ).toThrow('Cannot resume: worktree name was never captured.');
  });

  it('hookMode fallback when state not ready', () => {
    const result = buildClaudeResumePlan(makeCtx({ hookState: 'degraded' }));
    expect(result.hookMode).toBe('fallback');
  });

  it('omits optional args when fields are null/false', () => {
    const result = buildClaudeResumePlan(makeCtx({
      row: {
        permissionMode: null,
        effort: null,
        enableAutoMode: false,
        allowBypassPermissions: false,
      },
    }));
    expect(result.args).toEqual(['--resume', 'session-abc']);
  });
});

describe('buildClaudeCreatePlan', () => {
  function makeHook(state: HookRuntimeInfo['state'] = 'ready'): HookRuntimeInfo {
    return { state, port: 9999, warning: null };
  }

  function makeCtx(overrides: {
    input?: Partial<AgentCreateContext['input']>;
    command?: string;
    hookState?: HookRuntimeInfo['state'];
  } = {}): AgentCreateContext {
    return {
      input: { cwd: '/tmp', sessionType: 'claude' as const, ...overrides.input },
      command: overrides.command ?? 'claude',
      hookRuntime: makeHook(overrides.hookState),
      codexBridgeReady: false,
    };
  }

  it('full args with all Claude options', () => {
    const result = buildClaudeCreatePlan(makeCtx({
      input: {
        worktree: 'wt',
        permissionMode: 'auto',
        effort: 'high',
        enableAutoMode: true,
        allowBypassPermissions: true,
        initialPrompt: 'do stuff',
      },
      command: 'claude',
      hookState: 'ready',
    }));
    expect(result.args).toEqual([
      '--worktree', 'wt',
      '--permission-mode', 'auto',
      '--effort', 'high',
      '--enable-auto-mode',
      '--allow-dangerously-skip-permissions',
      'do stuff',
    ]);
    expect(result.hookMode).toBe('live');
    expect(result.dbFields).toEqual({
      permissionMode: 'auto',
      effort: 'high',
      enableAutoMode: 1,
      allowBypassPermissions: 1,
      worktree: 'wt',
    });
  });

  it('correct dbFields mapping', () => {
    // enableAutoMode: true → 1
    let result = buildClaudeCreatePlan(makeCtx({ input: { enableAutoMode: true } }));
    expect(result.dbFields.enableAutoMode).toBe(1);

    // enableAutoMode: false → 0
    result = buildClaudeCreatePlan(makeCtx({ input: { enableAutoMode: false } }));
    expect(result.dbFields.enableAutoMode).toBe(0);

    // enableAutoMode: undefined → null
    result = buildClaudeCreatePlan(makeCtx({ input: {} }));
    expect(result.dbFields.enableAutoMode).toBeNull();

    // allowBypassPermissions: true → 1
    result = buildClaudeCreatePlan(makeCtx({ input: { allowBypassPermissions: true } }));
    expect(result.dbFields.allowBypassPermissions).toBe(1);

    // allowBypassPermissions: false → 0
    result = buildClaudeCreatePlan(makeCtx({ input: { allowBypassPermissions: false } }));
    expect(result.dbFields.allowBypassPermissions).toBe(0);

    // allowBypassPermissions: undefined → null
    result = buildClaudeCreatePlan(makeCtx({ input: {} }));
    expect(result.dbFields.allowBypassPermissions).toBeNull();

    // worktree: undefined → null
    result = buildClaudeCreatePlan(makeCtx({ input: {} }));
    expect(result.dbFields.worktree).toBeNull();

    // worktree: '' → ''
    result = buildClaudeCreatePlan(makeCtx({ input: { worktree: '' } }));
    expect(result.dbFields.worktree).toBe('');

    // worktree: 'name' → 'name'
    result = buildClaudeCreatePlan(makeCtx({ input: { worktree: 'name' } }));
    expect(result.dbFields.worktree).toBe('name');
  });

  it('throws on initializing hook state', () => {
    expect(() =>
      buildClaudeCreatePlan(makeCtx({ command: 'claude', hookState: 'initializing' })),
    ).toThrow('Hook system is still initializing');
  });

  it('hookMode fallback when state not ready', () => {
    const result = buildClaudeCreatePlan(makeCtx({ command: 'claude', hookState: 'degraded' }));
    expect(result.hookMode).toBe('fallback');
  });
});
