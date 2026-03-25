import { describe, it, expect, beforeEach, vi } from 'vitest';

const killFn = vi.fn().mockResolvedValue(undefined);
const createFn = vi.fn().mockResolvedValue({ sessionId: 'new-sess' });

vi.stubGlobal('window', {
  mcode: {
    app: { getPlatform: () => 'darwin' },
    layout: { save: vi.fn().mockResolvedValue(undefined), load: vi.fn().mockResolvedValue(null) },
    preferences: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
    sessions: {
      clearAttention: vi.fn().mockResolvedValue(undefined),
      kill: killFn,
      create: createFn,
    },
  },
});

vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 0; });
vi.stubGlobal('document', { querySelector: vi.fn().mockReturnValue(null) });
vi.stubGlobal('HTMLElement', class HTMLElement {});

const { useTerminalPanelStore } = await import('../../../../src/renderer/stores/terminal-panel-store');
const { executeAppCommand } = await import('../../../../src/renderer/utils/app-commands');

function makeEntry(sessionId = 'sess-1') {
  return { sessionId, label: 'Terminal', cwd: '/home/user', repo: 'user' };
}

function resetPanel() {
  useTerminalPanelStore.setState({
    panelVisible: false,
    panelHeight: 200,
    tabGroups: {},
    splitTree: null,
    activeTabGroupId: null,
    terminals: {},
  });
}

describe('terminal panel app commands', () => {
  beforeEach(() => {
    resetPanel();
    killFn.mockClear();
    createFn.mockClear();
  });

  describe('split-terminal-horizontal', () => {
    it('splits the active tab group horizontally', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry('a'));
      const originalGroupId = useTerminalPanelStore.getState().activeTabGroupId;

      executeAppCommand({ command: 'split-terminal-horizontal' });

      const { splitTree, tabGroups, activeTabGroupId } = useTerminalPanelStore.getState();
      expect(splitTree?.type).toBe('split');
      if (splitTree?.type === 'split') expect(splitTree.direction).toBe('horizontal');
      expect(Object.keys(tabGroups)).toHaveLength(2);
      expect(activeTabGroupId).not.toBe(originalGroupId);
    });

    it('is a no-op when no active tab group exists', () => {
      executeAppCommand({ command: 'split-terminal-horizontal' });
      expect(useTerminalPanelStore.getState().splitTree).toBeNull();
    });
  });

  describe('split-terminal-vertical', () => {
    it('splits the active tab group vertically', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry('a'));

      executeAppCommand({ command: 'split-terminal-vertical' });

      const { splitTree } = useTerminalPanelStore.getState();
      expect(splitTree?.type).toBe('split');
      if (splitTree?.type === 'split') expect(splitTree.direction).toBe('vertical');
    });
  });

  describe('close-terminal', () => {
    it('removes the active terminal from the store', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry('sess-1'));

      executeAppCommand({ command: 'close-terminal' });

      expect(useTerminalPanelStore.getState().terminals['sess-1']).toBeUndefined();
    });

    it('calls sessions.kill with the active terminal sessionId', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry('sess-1'));

      executeAppCommand({ command: 'close-terminal' });

      expect(killFn).toHaveBeenCalledOnce();
      expect(killFn).toHaveBeenCalledWith('sess-1');
    });

    it('kills the correct terminal when multiple are open', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry('a'));
      useTerminalPanelStore.getState().addTerminal(makeEntry('b'));
      // 'b' is now active

      executeAppCommand({ command: 'close-terminal' });

      expect(killFn).toHaveBeenCalledWith('b');
      expect(useTerminalPanelStore.getState().terminals['a']).toBeDefined();
      expect(useTerminalPanelStore.getState().terminals['b']).toBeUndefined();
    });

    it('is a no-op when no terminal is open', () => {
      executeAppCommand({ command: 'close-terminal' });
      expect(killFn).not.toHaveBeenCalled();
    });
  });

  describe('cycle-terminal-tab', () => {
    it('cycles forward (direction: 1) wrapping around to first tab', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry('a'));
      useTerminalPanelStore.getState().addTerminal(makeEntry('b'));
      useTerminalPanelStore.getState().addTerminal(makeEntry('c'));
      // active is 'c'

      executeAppCommand({ command: 'cycle-terminal-tab', direction: 1 });

      const group = Object.values(useTerminalPanelStore.getState().tabGroups)[0];
      expect(group.activeTerminalId).toBe('a');
    });

    it('cycles backward (direction: -1)', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry('a'));
      useTerminalPanelStore.getState().addTerminal(makeEntry('b'));
      // active is 'b'

      executeAppCommand({ command: 'cycle-terminal-tab', direction: -1 });

      const group = Object.values(useTerminalPanelStore.getState().tabGroups)[0];
      expect(group.activeTerminalId).toBe('a');
    });

    it('is a no-op when only one tab exists', () => {
      useTerminalPanelStore.getState().addTerminal(makeEntry('a'));

      executeAppCommand({ command: 'cycle-terminal-tab', direction: 1 });

      const group = Object.values(useTerminalPanelStore.getState().tabGroups)[0];
      expect(group.activeTerminalId).toBe('a');
    });
  });
});
