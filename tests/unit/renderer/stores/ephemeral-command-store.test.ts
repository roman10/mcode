import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock window.mcode before importing the store
const killMock = vi.fn().mockResolvedValue(undefined);
vi.stubGlobal('window', {
  mcode: {
    sessions: { kill: killMock },
  },
});

const { useEphemeralCommandStore } = await import(
  '../../../../src/renderer/stores/ephemeral-command-store'
);

function makeCmd(overrides: Partial<import('../../../../src/renderer/stores/ephemeral-command-store').EphemeralCommand> = {}): import('../../../../src/renderer/stores/ephemeral-command-store').EphemeralCommand {
  return {
    id: 'cmd-1',
    sessionId: 'sess-1',
    command: 'echo hello',
    cwd: '/tmp',
    repo: 'tmp',
    status: 'running',
    exitCode: null,
    output: '',
    startedAt: Date.now(),
    endedAt: null,
    ...overrides,
  };
}

describe('ephemeral-command-store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    killMock.mockClear();
    // Reset store to initial state
    useEphemeralCommandStore.setState({
      commands: [],
      selectedCommandId: null,
      panelExpanded: false,
      panelPinned: false,
      panelHeight: 200,
      autoCollapseScheduled: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('addCommand', () => {
    it('prepends command, selects it, and expands panel', () => {
      const store = useEphemeralCommandStore.getState();
      store.addCommand(makeCmd({ id: 'a' }));

      const state = useEphemeralCommandStore.getState();
      expect(state.commands).toHaveLength(1);
      expect(state.selectedCommandId).toBe('a');
      expect(state.panelExpanded).toBe(true);
    });

    it('prepends new commands before existing ones', () => {
      const store = useEphemeralCommandStore.getState();
      store.addCommand(makeCmd({ id: 'a', sessionId: 'sa' }));
      store.addCommand(makeCmd({ id: 'b', sessionId: 'sb' }));

      const state = useEphemeralCommandStore.getState();
      expect(state.commands[0].id).toBe('b');
      expect(state.commands[1].id).toBe('a');
      expect(state.selectedCommandId).toBe('b');
    });
  });

  describe('appendOutput', () => {
    it('appends data to matching command', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      useEphemeralCommandStore.getState().appendOutput('sess-1', 'hello ');
      useEphemeralCommandStore.getState().appendOutput('sess-1', 'world');

      expect(useEphemeralCommandStore.getState().commands[0].output).toBe('hello world');
    });

    it('truncates output at 100KB', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      const bigData = 'x'.repeat(120 * 1024);
      useEphemeralCommandStore.getState().appendOutput('sess-1', bigData);

      expect(useEphemeralCommandStore.getState().commands[0].output.length).toBe(100 * 1024);
    });

    it('no-ops for unknown sessionId', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      useEphemeralCommandStore.getState().appendOutput('unknown', 'data');

      expect(useEphemeralCommandStore.getState().commands[0].output).toBe('');
    });
  });

  describe('completeCommand', () => {
    it('marks exit code 0 as success', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      useEphemeralCommandStore.getState().completeCommand('sess-1', 0);

      const cmd = useEphemeralCommandStore.getState().commands[0];
      expect(cmd.status).toBe('success');
      expect(cmd.exitCode).toBe(0);
      expect(cmd.endedAt).toBeTypeOf('number');
    });

    it('marks non-zero exit code as error', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      useEphemeralCommandStore.getState().completeCommand('sess-1', 1);

      expect(useEphemeralCommandStore.getState().commands[0].status).toBe('error');
    });

    it('schedules auto-collapse for success when not pinned', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      useEphemeralCommandStore.getState().completeCommand('sess-1', 0);

      expect(useEphemeralCommandStore.getState().autoCollapseScheduled).toBe(true);
    });

    it('does not schedule auto-collapse when pinned', () => {
      useEphemeralCommandStore.setState({ panelPinned: true });
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      useEphemeralCommandStore.getState().completeCommand('sess-1', 0);

      expect(useEphemeralCommandStore.getState().autoCollapseScheduled).toBe(false);
    });

    it('does not schedule auto-collapse for error', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      useEphemeralCommandStore.getState().completeCommand('sess-1', 1);

      expect(useEphemeralCommandStore.getState().autoCollapseScheduled).toBe(false);
    });

    it('auto-fades successful command after 5s if not selected', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd({ id: 'a', sessionId: 'sa' }));
      useEphemeralCommandStore.getState().addCommand(makeCmd({ id: 'b', sessionId: 'sb' }));
      // Select b (not a)
      useEphemeralCommandStore.getState().selectCommand('b');
      useEphemeralCommandStore.getState().completeCommand('sa', 0);

      expect(useEphemeralCommandStore.getState().commands).toHaveLength(2);

      vi.advanceTimersByTime(5000);

      // 'a' should have been dismissed
      const cmds = useEphemeralCommandStore.getState().commands;
      expect(cmds.find((c) => c.id === 'a')).toBeUndefined();
    });

    it('does not auto-fade if command is selected', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd({ id: 'a', sessionId: 'sa' }));
      // 'a' is selected (addCommand selects it)
      useEphemeralCommandStore.getState().completeCommand('sa', 0);

      vi.advanceTimersByTime(5000);

      // 'a' should still exist because it's selected
      expect(useEphemeralCommandStore.getState().commands.find((c) => c.id === 'a')).toBeDefined();
    });

    it('no-ops for already completed commands', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      useEphemeralCommandStore.getState().completeCommand('sess-1', 0);
      useEphemeralCommandStore.getState().completeCommand('sess-1', 1);

      // Should still be success from first call
      expect(useEphemeralCommandStore.getState().commands[0].status).toBe('success');
    });

    it('trims when exceeding MAX_COMPLETED_COMMANDS (50)', () => {
      // Add 51 completed commands
      for (let i = 0; i < 51; i++) {
        useEphemeralCommandStore.getState().addCommand(makeCmd({ id: `c${i}`, sessionId: `s${i}` }));
      }
      // Complete them all (newest to oldest to avoid trimming running ones)
      for (let i = 50; i >= 0; i--) {
        useEphemeralCommandStore.getState().completeCommand(`s${i}`, 1);
      }

      expect(useEphemeralCommandStore.getState().commands.length).toBeLessThanOrEqual(50);
    });
  });

  describe('selectCommand', () => {
    it('sets selected id and expands panel', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd({ id: 'a' }));
      useEphemeralCommandStore.getState().selectCommand('a');

      const state = useEphemeralCommandStore.getState();
      expect(state.selectedCommandId).toBe('a');
      expect(state.panelExpanded).toBe(true);
    });

    it('collapses panel when selecting null', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      useEphemeralCommandStore.getState().selectCommand(null);

      expect(useEphemeralCommandStore.getState().panelExpanded).toBe(false);
    });

    it('cancels auto-collapse', () => {
      useEphemeralCommandStore.setState({ autoCollapseScheduled: true });
      useEphemeralCommandStore.getState().selectCommand('any');

      expect(useEphemeralCommandStore.getState().autoCollapseScheduled).toBe(false);
    });
  });

  describe('dismissCommand', () => {
    it('removes the command', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd({ id: 'a' }));
      useEphemeralCommandStore.getState().dismissCommand('a');

      expect(useEphemeralCommandStore.getState().commands).toHaveLength(0);
    });

    it('auto-selects next command when dismissed is selected', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd({ id: 'a', sessionId: 'sa' }));
      useEphemeralCommandStore.getState().addCommand(makeCmd({ id: 'b', sessionId: 'sb' }));
      // b is selected (most recent add)
      useEphemeralCommandStore.getState().dismissCommand('b');

      expect(useEphemeralCommandStore.getState().selectedCommandId).toBe('a');
    });

    it('collapses panel when last command is dismissed', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      useEphemeralCommandStore.getState().dismissCommand('cmd-1');

      expect(useEphemeralCommandStore.getState().panelExpanded).toBe(false);
    });
  });

  describe('clearCompleted', () => {
    it('keeps running commands, removes completed', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd({ id: 'running', sessionId: 'sr' }));
      useEphemeralCommandStore.getState().addCommand(makeCmd({ id: 'done', sessionId: 'sd' }));
      useEphemeralCommandStore.getState().completeCommand('sd', 0);

      useEphemeralCommandStore.getState().clearCompleted();

      const cmds = useEphemeralCommandStore.getState().commands;
      expect(cmds).toHaveLength(1);
      expect(cmds[0].id).toBe('running');
    });

    it('collapses panel when no commands remain', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      useEphemeralCommandStore.getState().completeCommand('sess-1', 0);
      useEphemeralCommandStore.getState().clearCompleted();

      expect(useEphemeralCommandStore.getState().panelExpanded).toBe(false);
    });
  });

  describe('killCommand', () => {
    it('calls IPC kill for running command', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      useEphemeralCommandStore.getState().killCommand('cmd-1');

      expect(killMock).toHaveBeenCalledWith('sess-1');
    });

    it('does not call IPC kill for completed command', () => {
      useEphemeralCommandStore.getState().addCommand(makeCmd());
      useEphemeralCommandStore.getState().completeCommand('sess-1', 0);
      useEphemeralCommandStore.getState().killCommand('cmd-1');

      expect(killMock).not.toHaveBeenCalled();
    });
  });

  describe('panel controls', () => {
    it('setPanelExpanded cancels auto-collapse', () => {
      useEphemeralCommandStore.setState({ autoCollapseScheduled: true });
      useEphemeralCommandStore.getState().setPanelExpanded(false);

      expect(useEphemeralCommandStore.getState().autoCollapseScheduled).toBe(false);
    });

    it('togglePanelPinned flips state', () => {
      expect(useEphemeralCommandStore.getState().panelPinned).toBe(false);
      useEphemeralCommandStore.getState().togglePanelPinned();
      expect(useEphemeralCommandStore.getState().panelPinned).toBe(true);
      useEphemeralCommandStore.getState().togglePanelPinned();
      expect(useEphemeralCommandStore.getState().panelPinned).toBe(false);
    });

    it('setPanelHeight updates height', () => {
      useEphemeralCommandStore.getState().setPanelHeight(400);
      expect(useEphemeralCommandStore.getState().panelHeight).toBe(400);
    });
  });
});
