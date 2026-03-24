import { describe, it, expect, beforeEach } from 'vitest';

const { useTerminalPanelStore } = await import(
  '../../../../src/renderer/stores/terminal-panel-store'
);

function makeEntry(
  overrides: Partial<import('../../../../src/renderer/stores/terminal-panel-store').TerminalEntry> = {},
): import('../../../../src/renderer/stores/terminal-panel-store').TerminalEntry {
  return {
    sessionId: overrides.sessionId ?? 'sess-1',
    label: overrides.label ?? 'Terminal',
    cwd: overrides.cwd ?? '/home/user',
    repo: overrides.repo ?? 'user',
    isEphemeral: overrides.isEphemeral ?? false,
    ...overrides,
  };
}

describe('terminal-panel-store', () => {
  beforeEach(() => {
    useTerminalPanelStore.setState({
      panelVisible: false,
      panelHeight: 200,
      panelPinned: false,
      tabGroups: {},
      splitTree: null,
      activeTabGroupId: null,
      focusInPanel: false,
      terminals: {},
    });
  });

  describe('addTerminal', () => {
    it('adds terminal to a new tab group and expands panel', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry());

      const state = useTerminalPanelStore.getState();
      expect(state.panelVisible).toBe(true);
      expect(Object.keys(state.terminals)).toHaveLength(1);
      expect(state.terminals['sess-1']).toBeDefined();
      expect(Object.keys(state.tabGroups)).toHaveLength(1);
      expect(state.splitTree).not.toBeNull();
      expect(state.splitTree?.type).toBe('leaf');
    });

    it('adds second terminal to the active tab group', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'a' }));
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'b' }));

      const state = useTerminalPanelStore.getState();
      expect(Object.keys(state.terminals)).toHaveLength(2);
      // Both should be in the same tab group
      expect(Object.keys(state.tabGroups)).toHaveLength(1);
      const group = Object.values(state.tabGroups)[0];
      expect(group.terminalIds).toEqual(['a', 'b']);
      expect(group.activeTerminalId).toBe('b');
    });
  });

  describe('removeTerminal', () => {
    it('removes terminal and collapses panel when empty', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry());
      useTerminalPanelStore.getState().removeTerminal('sess-1');

      const state = useTerminalPanelStore.getState();
      expect(Object.keys(state.terminals)).toHaveLength(0);
      expect(state.panelVisible).toBe(false);
    });

    it('updates active terminal when removing the active one', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'a' }));
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'b' }));
      useTerminalPanelStore.getState().removeTerminal('b');

      const group = Object.values(useTerminalPanelStore.getState().tabGroups)[0];
      expect(group.activeTerminalId).toBe('a');
      expect(group.terminalIds).toEqual(['a']);
    });
  });

  describe('activateTerminal', () => {
    it('sets the active terminal in the group and expands panel', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'a' }));
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'b' }));
      useTerminalPanelStore.getState().activateTerminal('a');

      const group = Object.values(useTerminalPanelStore.getState().tabGroups)[0];
      expect(group.activeTerminalId).toBe('a');
    });
  });

  describe('cycleTab', () => {
    it('cycles forward through tabs', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'a' }));
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'b' }));
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'c' }));

      // Currently active is 'c' (last added)
      useTerminalPanelStore.getState().cycleTab(1);
      const group = Object.values(useTerminalPanelStore.getState().tabGroups)[0];
      expect(group.activeTerminalId).toBe('a'); // wraps around
    });

    it('cycles backward through tabs', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'a' }));
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'b' }));

      useTerminalPanelStore.getState().cycleTab(-1);
      const group = Object.values(useTerminalPanelStore.getState().tabGroups)[0];
      expect(group.activeTerminalId).toBe('a');
    });
  });

  describe('ephemeral lifecycle', () => {
    it('completeEphemeral sets status on success', () => {
      useTerminalPanelStore.getState().addTerminal(
        makeEntry({ sessionId: 'e1', isEphemeral: true, ephemeralStatus: 'running' }),
      );
      useTerminalPanelStore.getState().completeEphemeral('e1', 0);

      expect(useTerminalPanelStore.getState().terminals['e1'].ephemeralStatus).toBe('success');
      expect(useTerminalPanelStore.getState().terminals['e1'].ephemeralExitCode).toBe(0);
    });

    it('completeEphemeral sets status on error', () => {
      useTerminalPanelStore.getState().addTerminal(
        makeEntry({ sessionId: 'e1', isEphemeral: true, ephemeralStatus: 'running' }),
      );
      useTerminalPanelStore.getState().completeEphemeral('e1', 1);

      expect(useTerminalPanelStore.getState().terminals['e1'].ephemeralStatus).toBe('error');
    });

    it('keepEphemeral converts to persistent terminal', () => {
      useTerminalPanelStore.getState().addTerminal(
        makeEntry({
          sessionId: 'e1',
          isEphemeral: true,
          ephemeralCommand: 'npm test',
          ephemeralStatus: 'success',
        }),
      );
      useTerminalPanelStore.getState().keepEphemeral('e1');

      const t = useTerminalPanelStore.getState().terminals['e1'];
      expect(t.isEphemeral).toBe(false);
      expect(t.ephemeralCommand).toBeUndefined();
      expect(t.ephemeralStatus).toBeUndefined();
    });

    it('ignores completeEphemeral for non-ephemeral terminals', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 's1' }));
      useTerminalPanelStore.getState().completeEphemeral('s1', 0);

      // Should be unchanged
      expect(useTerminalPanelStore.getState().terminals['s1'].ephemeralStatus).toBeUndefined();
    });
  });

  describe('panel chrome', () => {
    it('togglePanelVisible toggles visibility', () => {
      expect(useTerminalPanelStore.getState().panelVisible).toBe(false);
      useTerminalPanelStore.getState().togglePanelVisible();
      expect(useTerminalPanelStore.getState().panelVisible).toBe(true);
      useTerminalPanelStore.getState().togglePanelVisible();
      expect(useTerminalPanelStore.getState().panelVisible).toBe(false);
    });

    it('togglePanelPinned toggles pinned state', () => {
      expect(useTerminalPanelStore.getState().panelPinned).toBe(false);
      useTerminalPanelStore.getState().togglePanelPinned();
      expect(useTerminalPanelStore.getState().panelPinned).toBe(true);
    });

    it('setPanelHeight updates height', () => {
      useTerminalPanelStore.getState().setPanelHeight(400);
      expect(useTerminalPanelStore.getState().panelHeight).toBe(400);
    });
  });

  describe('updateTerminalLabel', () => {
    it('updates the label of an existing terminal', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry());
      useTerminalPanelStore.getState().updateTerminalLabel('sess-1', 'My Terminal');

      expect(useTerminalPanelStore.getState().terminals['sess-1'].label).toBe('My Terminal');
    });
  });

  describe('queries', () => {
    it('getActiveTerminal returns current active', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'a' }));
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'b' }));

      const active = useTerminalPanelStore.getState().getActiveTerminal();
      expect(active?.sessionId).toBe('b');
    });

    it('getAllTerminalSessionIds returns all session IDs', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'a' }));
      useTerminalPanelStore.getState().addTerminal(makeEntry({ sessionId: 'b' }));

      const ids = useTerminalPanelStore.getState().getAllTerminalSessionIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
    });
  });
});
