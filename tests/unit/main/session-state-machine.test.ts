import { describe, it, expect } from 'vitest';
import {
  computeTransition,
  resolveAttention,
  USER_CHOICE_TOOLS,
} from '../../../src/main/session/session-state-machine';
import type {
  TransitionContext,
  HookEventName,
  AttentionRule,
} from '../../../src/main/session/session-state-machine';
import type { SessionStatus, SessionAttentionLevel } from '../../../src/shared/types';

// --- Helpers ---

function ctx(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    currentStatus: 'active',
    lastTool: null,
    toolName: null,
    ...overrides,
  };
}

/** Simulate a multi-step transition sequence, threading status and attention through. */
function runSequence(
  steps: Array<{ event: HookEventName; toolName?: string }>,
  initial: { status: SessionStatus; attention: SessionAttentionLevel; lastTool?: string | null },
) {
  let status = initial.status;
  let attention = initial.attention;
  let lastTool: string | null = initial.lastTool ?? null;
  const results: Array<{ status: SessionStatus; attention: SessionAttentionLevel }> = [];

  for (const step of steps) {
    const result = computeTransition(step.event, {
      currentStatus: status,
      lastTool,
      toolName: step.toolName ?? null,
    });
    if (!result) {
      results.push({ status, attention });
      continue;
    }

    const resolved = resolveAttention(result.attention, attention, {
      hasPendingTasks: false,
    });

    status = result.status;
    attention = resolved.level;
    if (result.lastTool.type === 'set') lastTool = result.lastTool.toolName;
    else if (result.lastTool.type === 'clear') lastTool = null;
    results.push({ status, attention });
  }
  return results;
}

// --- computeTransition ---

describe('computeTransition', () => {
  describe('SessionStart', () => {
    it('starting → active', () => {
      const r = computeTransition('SessionStart', ctx({ currentStatus: 'starting' }));
      expect(r!.status).toBe('active');
      expect(r!.selfHealed).toBe(false);
    });

    it('active → active (status unchanged), clears action attention', () => {
      const r = computeTransition('SessionStart', ctx({ currentStatus: 'active' }));
      expect(r!.status).toBe('active');
      expect(r!.attention.type).toBe('clear-if-action');
    });

    it('idle → idle (status unchanged), clears action attention', () => {
      const r = computeTransition('SessionStart', ctx({ currentStatus: 'idle' }));
      expect(r!.status).toBe('idle');
      expect(r!.attention.type).toBe('clear-if-action');
    });

    it('ended → null', () => {
      expect(computeTransition('SessionStart', ctx({ currentStatus: 'ended' }))).toBeNull();
    });
  });

  describe('PreToolUse', () => {
    it('idle → active, clears action attention', () => {
      const r = computeTransition('PreToolUse', ctx({ currentStatus: 'idle' }));
      expect(r!.status).toBe('active');
      expect(r!.attention.type).toBe('clear-if-action');
    });

    it('waiting → active, clears action attention', () => {
      const r = computeTransition('PreToolUse', ctx({ currentStatus: 'waiting' }));
      expect(r!.status).toBe('active');
      expect(r!.attention.type).toBe('clear-if-action');
    });

    it('active → active, preserves attention', () => {
      const r = computeTransition('PreToolUse', ctx({ currentStatus: 'active' }));
      expect(r!.status).toBe('active');
      expect(r!.attention.type).toBe('preserve');
    });

    it('sets lastTool to toolName', () => {
      const r = computeTransition('PreToolUse', ctx({ toolName: 'Read' }));
      expect(r!.lastTool).toEqual({ type: 'set', toolName: 'Read' });
    });

    it('preserves lastTool when toolName is null', () => {
      const r = computeTransition('PreToolUse', ctx({ toolName: null }));
      expect(r!.lastTool).toEqual({ type: 'preserve' });
    });
  });

  describe('PostToolUse', () => {
    it('idle → active, clears action attention', () => {
      const r = computeTransition('PostToolUse', ctx({ currentStatus: 'idle' }));
      expect(r!.status).toBe('active');
      expect(r!.attention.type).toBe('clear-if-action');
    });

    it('waiting → active, clears action attention', () => {
      const r = computeTransition('PostToolUse', ctx({ currentStatus: 'waiting' }));
      expect(r!.status).toBe('active');
      expect(r!.attention.type).toBe('clear-if-action');
    });

    it('active → active, preserves attention', () => {
      const r = computeTransition('PostToolUse', ctx({ currentStatus: 'active' }));
      expect(r!.status).toBe('active');
      expect(r!.attention.type).toBe('preserve');
    });

    it('sets lastTool to toolName', () => {
      const r = computeTransition('PostToolUse', ctx({ toolName: 'Bash' }));
      expect(r!.lastTool).toEqual({ type: 'set', toolName: 'Bash' });
    });
  });

  describe('Stop', () => {
    it('active → idle, attention = set-action-if-active-no-pending', () => {
      const r = computeTransition('Stop', ctx({ currentStatus: 'active' }));
      expect(r!.status).toBe('idle');
      expect(r!.attention.type).toBe('set-action-if-active-no-pending');
    });

    it('idle → idle, attention = preserve (no re-raise)', () => {
      const r = computeTransition('Stop', ctx({ currentStatus: 'idle' }));
      expect(r!.status).toBe('idle');
      expect(r!.attention.type).toBe('preserve');
    });

    it('lastTool=ExitPlanMode → waiting, action, clears lastTool', () => {
      const r = computeTransition('Stop', ctx({ lastTool: 'ExitPlanMode' }));
      expect(r!.status).toBe('waiting');
      expect(r!.attention).toEqual({ type: 'set-action', reason: 'Waiting for your response' });
      expect(r!.lastTool).toEqual({ type: 'clear' });
    });

    it('lastTool=AskUserQuestion → waiting, action, clears lastTool', () => {
      const r = computeTransition('Stop', ctx({ lastTool: 'AskUserQuestion' }));
      expect(r!.status).toBe('waiting');
      expect(r!.attention).toEqual({ type: 'set-action', reason: 'Waiting for your response' });
      expect(r!.lastTool).toEqual({ type: 'clear' });
    });

    it('lastTool=Read → idle (not a user-choice tool)', () => {
      const r = computeTransition('Stop', ctx({ currentStatus: 'active', lastTool: 'Read' }));
      expect(r!.status).toBe('idle');
    });

    it('lastTool=null → idle', () => {
      const r = computeTransition('Stop', ctx({ currentStatus: 'active', lastTool: null }));
      expect(r!.status).toBe('idle');
    });
  });

  describe('PermissionRequest', () => {
    it('any → waiting, attention=action', () => {
      const r = computeTransition('PermissionRequest', ctx({ currentStatus: 'active' }));
      expect(r!.status).toBe('waiting');
      expect(r!.attention.type).toBe('set-action');
    });

    it('includes toolName in reason when present', () => {
      const r = computeTransition('PermissionRequest', ctx({ toolName: 'Bash' }));
      expect(r!.attention).toEqual({ type: 'set-action', reason: 'Permission needed: Bash' });
    });

    it('generic reason when toolName absent', () => {
      const r = computeTransition('PermissionRequest', ctx({ toolName: null }));
      expect(r!.attention).toEqual({ type: 'set-action', reason: 'Permission needed' });
    });
  });

  describe('Notification', () => {
    it('status unchanged, attention = set-info-if-not-action', () => {
      const r = computeTransition('Notification', ctx({ currentStatus: 'active' }));
      expect(r!.status).toBe('active');
      expect(r!.attention).toEqual({ type: 'set-info-if-not-action', reason: 'Notification from Claude' });
    });
  });

  describe('PostToolUseFailure', () => {
    it('status unchanged, attention = preserve', () => {
      const r = computeTransition('PostToolUseFailure', ctx({ currentStatus: 'active' }));
      expect(r!.status).toBe('active');
      expect(r!.attention.type).toBe('preserve');
    });
  });

  describe('UserPromptSubmit', () => {
    it('idle → active, clears action attention', () => {
      const r = computeTransition('UserPromptSubmit', ctx({ currentStatus: 'idle' }));
      expect(r!.status).toBe('active');
      expect(r!.attention.type).toBe('clear-if-action');
    });

    it('waiting → active, clears action attention', () => {
      const r = computeTransition('UserPromptSubmit', ctx({ currentStatus: 'waiting' }));
      expect(r!.status).toBe('active');
      expect(r!.attention.type).toBe('clear-if-action');
    });

    it('active → active, preserves attention', () => {
      const r = computeTransition('UserPromptSubmit', ctx({ currentStatus: 'active' }));
      expect(r!.status).toBe('active');
      expect(r!.attention.type).toBe('preserve');
    });

    it('clears lastTool', () => {
      const r = computeTransition('UserPromptSubmit', ctx({ lastTool: 'ExitPlanMode' }));
      expect(r!.lastTool).toEqual({ type: 'clear' });
    });
  });

  describe('SessionEnd', () => {
    it('any → ended, attention = clear', () => {
      const r = computeTransition('SessionEnd', ctx({ currentStatus: 'active' }));
      expect(r!.status).toBe('ended');
      expect(r!.attention).toEqual({ type: 'clear' });
    });
  });
});

// --- Terminal state guard ---

describe('ended state guard', () => {
  const events: HookEventName[] = [
    'SessionStart', 'PreToolUse', 'PostToolUse', 'Stop',
    'PermissionRequest', 'Notification', 'PostToolUseFailure', 'SessionEnd',
    'UserPromptSubmit',
  ];

  for (const event of events) {
    it(`${event} from ended → null`, () => {
      expect(computeTransition(event, ctx({ currentStatus: 'ended' }))).toBeNull();
    });
  }
});

// --- Self-healing ---

describe('self-healing (starting + non-SessionStart)', () => {
  it('PreToolUse from starting → active, selfHealed=true', () => {
    const r = computeTransition('PreToolUse', ctx({ currentStatus: 'starting', toolName: 'Read' }));
    expect(r!.status).toBe('active');
    expect(r!.selfHealed).toBe(true);
  });

  it('Stop from starting → idle (self-heals to active, then Stop), selfHealed=true', () => {
    const r = computeTransition('Stop', ctx({ currentStatus: 'starting' }));
    expect(r!.status).toBe('idle');
    expect(r!.selfHealed).toBe(true);
    // Attention rule should be set-action-if-active-no-pending (effective status was active)
    expect(r!.attention.type).toBe('set-action-if-active-no-pending');
  });

  it('PermissionRequest from starting → waiting, selfHealed=true', () => {
    const r = computeTransition('PermissionRequest', ctx({ currentStatus: 'starting' }));
    expect(r!.status).toBe('waiting');
    expect(r!.selfHealed).toBe(true);
  });

  it('SessionStart from starting → active, selfHealed=false (normal path)', () => {
    const r = computeTransition('SessionStart', ctx({ currentStatus: 'starting' }));
    expect(r!.status).toBe('active');
    expect(r!.selfHealed).toBe(false);
  });
});

// --- resolveAttention ---

describe('resolveAttention', () => {
  const noPending = { hasPendingTasks: false };

  describe('clear-if-action', () => {
    const rule: AttentionRule = { type: 'clear-if-action' };

    it('current=action → level=none', () => {
      const r = resolveAttention(rule, 'action', noPending);
      expect(r.level).toBe('none');
    });

    it('current=none → unchanged', () => {
      const r = resolveAttention(rule, 'none', noPending);
      expect(r.level).toBe('none');
      expect(r.reason).toBeNull();
    });

    it('current=info → unchanged', () => {
      const r = resolveAttention(rule, 'info', noPending);
      expect(r.level).toBe('info');
      expect(r.reason).toBeNull();
    });
  });

  describe('set-action', () => {
    const rule: AttentionRule = { type: 'set-action', reason: 'Permission needed: Bash' };

    it('always returns level=action with reason', () => {
      const r = resolveAttention(rule, 'none', noPending);
      expect(r.level).toBe('action');
      expect(r.reason).toBe('Permission needed: Bash');
    });

    it('overwrites reason when attention already action', () => {
      const r = resolveAttention(rule, 'action', noPending);
      expect(r.level).toBe('action');
      expect(r.reason).toBe('Permission needed: Bash');
    });
  });

  describe('set-action-if-active-no-pending', () => {
    const rule: AttentionRule = { type: 'set-action-if-active-no-pending', reason: 'Claude finished — awaiting next input' };

    it('no pending, current=none → action with reason', () => {
      const r = resolveAttention(rule, 'none', noPending);
      expect(r.level).toBe('action');
      expect(r.reason).toBe('Claude finished — awaiting next input');
    });

    it('no pending, current=info → action with reason', () => {
      const r = resolveAttention(rule, 'info', noPending);
      expect(r.level).toBe('action');
      expect(r.reason).toBe('Claude finished — awaiting next input');
    });

    it('no pending, current=action → preserved (no reason update)', () => {
      const r = resolveAttention(rule, 'action', noPending);
      expect(r.level).toBe('action');
      expect(r.reason).toBeNull();
    });

    it('has pending → current preserved', () => {
      const r = resolveAttention(rule, 'none', { hasPendingTasks: true });
      expect(r.level).toBe('none');
      expect(r.reason).toBeNull();
    });
  });

  describe('set-info-if-not-action', () => {
    const rule: AttentionRule = { type: 'set-info-if-not-action', reason: 'Notification from Claude' };

    it('current=none → info with reason', () => {
      const r = resolveAttention(rule, 'none', noPending);
      expect(r.level).toBe('info');
      expect(r.reason).toBe('Notification from Claude');
    });

    it('current=info → info with reason (updates reason)', () => {
      const r = resolveAttention(rule, 'info', noPending);
      expect(r.level).toBe('info');
      expect(r.reason).toBe('Notification from Claude');
    });

    it('current=action → preserved', () => {
      const r = resolveAttention(rule, 'action', noPending);
      expect(r.level).toBe('action');
      expect(r.reason).toBeNull();
    });
  });

  describe('clear', () => {
    const rule: AttentionRule = { type: 'clear' };

    it('always returns none regardless of current attention', () => {
      for (const current of ['none', 'info', 'action'] as SessionAttentionLevel[]) {
        const r = resolveAttention(rule, current, noPending);
        expect(r.level).toBe('none');
        expect(r.reason).toBeNull();
      }
    });
  });

  describe('preserve', () => {
    const rule: AttentionRule = { type: 'preserve' };

    it('returns current level with null reason', () => {
      expect(resolveAttention(rule, 'info', noPending)).toEqual({ level: 'info', reason: null });
      expect(resolveAttention(rule, 'none', noPending)).toEqual({ level: 'none', reason: null });
      expect(resolveAttention(rule, 'action', noPending)).toEqual({ level: 'action', reason: null });
    });
  });
});

// --- Multi-step sequences ---

describe('multi-step sequences', () => {
  it('normal flow: SessionStart → PreToolUse → PostToolUse → Stop', () => {
    const results = runSequence(
      [
        { event: 'SessionStart' },
        { event: 'PreToolUse', toolName: 'Read' },
        { event: 'PostToolUse', toolName: 'Read' },
        { event: 'Stop' },
      ],
      { status: 'starting', attention: 'none' },
    );
    expect(results.map((r) => r.status)).toEqual(['active', 'active', 'active', 'idle']);
    expect(results[3].attention).toBe('action');
  });

  it('permission flow: active → PermissionRequest → PostToolUse → Stop', () => {
    const results = runSequence(
      [
        { event: 'PermissionRequest', toolName: 'Bash' },
        { event: 'PostToolUse', toolName: 'Bash' },
        { event: 'Stop' },
      ],
      { status: 'active', attention: 'none' },
    );
    expect(results.map((r) => r.status)).toEqual(['waiting', 'active', 'idle']);
    expect(results[0].attention).toBe('action');
    expect(results[1].attention).toBe('none');
    expect(results[2].attention).toBe('action');
  });

  it('plan mode flow: PreToolUse(ExitPlanMode) → PostToolUse(ExitPlanMode) → Stop', () => {
    const results = runSequence(
      [
        { event: 'PreToolUse', toolName: 'ExitPlanMode' },
        { event: 'PostToolUse', toolName: 'ExitPlanMode' },
        { event: 'Stop' },
      ],
      { status: 'active', attention: 'none' },
    );
    expect(results.map((r) => r.status)).toEqual(['active', 'active', 'waiting']);
    expect(results[2].attention).toBe('action');
  });

  it('resume from user-choice: waiting → PreToolUse → PostToolUse → Stop', () => {
    const results = runSequence(
      [
        { event: 'PreToolUse', toolName: 'Write' },
        { event: 'PostToolUse', toolName: 'Write' },
        { event: 'Stop' },
      ],
      { status: 'waiting', attention: 'action' },
    );
    expect(results.map((r) => r.status)).toEqual(['active', 'active', 'idle']);
    // Action attention cleared on resume
    expect(results[0].attention).toBe('none');
    // Re-set on idle
    expect(results[2].attention).toBe('action');
  });

  it('Codex flow: SessionStart → PreToolUse → Stop → UserPromptSubmit → PreToolUse → Stop', () => {
    const results = runSequence(
      [
        { event: 'SessionStart' },
        { event: 'PreToolUse', toolName: 'Bash' },
        { event: 'Stop' },
        { event: 'UserPromptSubmit' },
        { event: 'PreToolUse', toolName: 'Bash' },
        { event: 'Stop' },
      ],
      { status: 'starting', attention: 'none' },
    );
    expect(results.map((r) => r.status)).toEqual([
      'active', 'active', 'idle', 'active', 'active', 'idle',
    ]);
    // UserPromptSubmit clears the action attention set by Stop
    expect(results[2].attention).toBe('action');
    expect(results[3].attention).toBe('none');
  });

  it('notification does not override action: PermissionRequest → Notification', () => {
    const results = runSequence(
      [
        { event: 'PermissionRequest', toolName: 'Bash' },
        { event: 'Notification' },
      ],
      { status: 'active', attention: 'none' },
    );
    expect(results[0].attention).toBe('action');
    expect(results[1].attention).toBe('action');
  });
});

// --- USER_CHOICE_TOOLS constant ---

describe('USER_CHOICE_TOOLS', () => {
  it('contains ExitPlanMode and AskUserQuestion', () => {
    expect(USER_CHOICE_TOOLS.has('ExitPlanMode')).toBe(true);
    expect(USER_CHOICE_TOOLS.has('AskUserQuestion')).toBe(true);
  });

  it('does not contain regular tools', () => {
    expect(USER_CHOICE_TOOLS.has('Read')).toBe(false);
    expect(USER_CHOICE_TOOLS.has('Bash')).toBe(false);
  });
});
