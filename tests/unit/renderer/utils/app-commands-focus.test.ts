import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBalancedTreeFromLeaves } from 'react-mosaic-component';
import { makeSession } from '../../test-factories';

// Mock window.mcode before importing stores
vi.stubGlobal('window', {
  mcode: {
    layout: { save: vi.fn().mockResolvedValue(undefined), load: vi.fn().mockResolvedValue(null) },
    preferences: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
    sessions: { clearAttention: vi.fn().mockResolvedValue(undefined) },
  },
});

// Mock DOM APIs for toggle-terminal-panel tests
vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 0; });
vi.stubGlobal('document', { querySelector: vi.fn().mockReturnValue(null), activeElement: null });
vi.stubGlobal('HTMLElement', class HTMLElement {});

const { useLayoutStore } = await import('../../../../src/renderer/stores/layout-store');
const { useSessionStore } = await import('../../../../src/renderer/stores/session-store');
const { useTerminalPanelStore } = await import('../../../../src/renderer/stores/terminal-panel-store');
const { executeAppCommand } = await import('../../../../src/renderer/utils/app-commands');

function resetStores() {
  useLayoutStore.setState({
    mosaicTree: null,
    viewMode: 'tiles',
    kanbanExpandedSessionId: null,
    selectedTileId: null,
  });
  useSessionStore.setState({
    sessions: {},
    selectedSessionId: null,
  });
}

describe('focus commands — tile visibility filtering', () => {
  beforeEach(resetStores);

  it('focus-next skips sessions without visible tiles', () => {
    useSessionStore.setState({
      sessions: {
        s1: makeSession({ sessionId: 's1', startedAt: '2026-03-20T10:00:00Z' }),
        s2: makeSession({ sessionId: 's2', startedAt: '2026-03-21T10:00:00Z' }),
        s3: makeSession({ sessionId: 's3', startedAt: '2026-03-22T10:00:00Z' }),
      },
      selectedSessionId: 's3',
    });
    // Only s1 and s3 have tiles (s2's tile was closed)
    useLayoutStore.setState({
      viewMode: 'tiles',
      mosaicTree: createBalancedTreeFromLeaves(['session:s3', 'session:s1']),
    });

    executeAppCommand({ command: 'focus-next-session' });

    // s3 → next visible is s1 (s2 skipped)
    expect(useSessionStore.getState().selectedSessionId).toBe('s1');
  });

  it('focus-prev skips sessions without visible tiles', () => {
    useSessionStore.setState({
      sessions: {
        s1: makeSession({ sessionId: 's1', startedAt: '2026-03-20T10:00:00Z' }),
        s2: makeSession({ sessionId: 's2', startedAt: '2026-03-21T10:00:00Z' }),
        s3: makeSession({ sessionId: 's3', startedAt: '2026-03-22T10:00:00Z' }),
      },
      selectedSessionId: 's1',
    });
    useLayoutStore.setState({
      viewMode: 'tiles',
      mosaicTree: createBalancedTreeFromLeaves(['session:s3', 'session:s1']),
    });

    executeAppCommand({ command: 'focus-prev-session' });

    // s1 → prev visible is s3 (s2 skipped, wraps around)
    expect(useSessionStore.getState().selectedSessionId).toBe('s3');
  });

  it('focus-session-index respects visible tiles', () => {
    useSessionStore.setState({
      sessions: {
        s1: makeSession({ sessionId: 's1', startedAt: '2026-03-20T10:00:00Z' }),
        s2: makeSession({ sessionId: 's2', startedAt: '2026-03-21T10:00:00Z' }),
        s3: makeSession({ sessionId: 's3', startedAt: '2026-03-22T10:00:00Z' }),
      },
    });
    // Only s1 and s3 have tiles
    useLayoutStore.setState({
      viewMode: 'tiles',
      mosaicTree: createBalancedTreeFromLeaves(['session:s3', 'session:s1']),
    });

    // Index 0 → first navigable session (s3, newest)
    executeAppCommand({ command: 'focus-session-index', index: 0 });
    expect(useSessionStore.getState().selectedSessionId).toBe('s3');

    // Index 1 → second navigable session (s1)
    executeAppCommand({ command: 'focus-session-index', index: 1 });
    expect(useSessionStore.getState().selectedSessionId).toBe('s1');
  });

  it('no-ops when no tiles are visible', () => {
    useSessionStore.setState({
      sessions: {
        s1: makeSession({ sessionId: 's1' }),
      },
      selectedSessionId: null,
    });
    useLayoutStore.setState({ viewMode: 'tiles', mosaicTree: null });

    executeAppCommand({ command: 'focus-next-session' });

    expect(useSessionStore.getState().selectedSessionId).toBeNull();
  });

  it('kanban mode cycles through all open sessions (no tile filtering)', () => {
    useSessionStore.setState({
      sessions: {
        s1: makeSession({ sessionId: 's1', startedAt: '2026-03-20T10:00:00Z' }),
        s2: makeSession({ sessionId: 's2', startedAt: '2026-03-21T10:00:00Z' }),
        s3: makeSession({ sessionId: 's3', startedAt: '2026-03-22T10:00:00Z' }),
      },
      selectedSessionId: 's3',
    });
    // No tiles in mosaic (kanban doesn't use mosaic for session display)
    useLayoutStore.setState({ viewMode: 'kanban', mosaicTree: null });

    executeAppCommand({ command: 'focus-next-session' });

    // Should cycle to s2 (next in canonical order: s3→s2→s1)
    expect(useSessionStore.getState().selectedSessionId).toBe('s2');
  });

  it('focus-next includes file viewer tiles', () => {
    useSessionStore.setState({
      sessions: { s1: makeSession({ sessionId: 's1' }) },
      selectedSessionId: 's1',
    });
    useLayoutStore.setState({
      viewMode: 'tiles',
      mosaicTree: createBalancedTreeFromLeaves(['session:s1', 'file:/foo/bar.ts']),
    });

    executeAppCommand({ command: 'focus-next-session' });

    expect(useSessionStore.getState().selectedSessionId).toBeNull();
    expect(useLayoutStore.getState().selectedTileId).toBe('file:/foo/bar.ts');
  });

  it('focus-next from viewer tile cycles to session tile', () => {
    useSessionStore.setState({
      sessions: { s1: makeSession({ sessionId: 's1' }) },
      selectedSessionId: null,
    });
    useLayoutStore.setState({
      viewMode: 'tiles',
      mosaicTree: createBalancedTreeFromLeaves(['session:s1', 'file:/foo/bar.ts']),
      selectedTileId: 'file:/foo/bar.ts',
    });

    executeAppCommand({ command: 'focus-next-session' });

    expect(useSessionStore.getState().selectedSessionId).toBe('s1');
    expect(useLayoutStore.getState().selectedTileId).toBe('session:s1');
  });

  it('focus-prev includes diff viewer tiles', () => {
    useSessionStore.setState({
      sessions: { s1: makeSession({ sessionId: 's1' }) },
      selectedSessionId: 's1',
    });
    useLayoutStore.setState({
      viewMode: 'tiles',
      mosaicTree: createBalancedTreeFromLeaves(['diff:/foo/bar.ts', 'session:s1']),
    });

    executeAppCommand({ command: 'focus-prev-session' });

    expect(useSessionStore.getState().selectedSessionId).toBeNull();
    expect(useLayoutStore.getState().selectedTileId).toBe('diff:/foo/bar.ts');
  });

  it('still skips ended sessions in both modes', () => {
    useSessionStore.setState({
      sessions: {
        s1: makeSession({ sessionId: 's1', status: 'active' }),
        s2: makeSession({ sessionId: 's2', status: 'ended' }),
      },
      selectedSessionId: 's1',
    });
    useLayoutStore.setState({
      viewMode: 'tiles',
      mosaicTree: createBalancedTreeFromLeaves(['session:s1', 'session:s2']),
    });

    executeAppCommand({ command: 'focus-next-session' });

    // s2 is ended, so wraps back to s1
    expect(useSessionStore.getState().selectedSessionId).toBe('s1');
  });
});

describe('toggle-terminal-panel command', () => {
  let mockPanelEl: { contains: ReturnType<typeof vi.fn> } | null;
  let mockFocusTarget: { focus: ReturnType<typeof vi.fn> };
  let mockWorkspaceTile: { focus: ReturnType<typeof vi.fn> };

  function resetPanel() {
    useTerminalPanelStore.setState({
      panelVisible: false,
      panelHeight: 200,
      tabGroups: {},
      splitTree: null,
      activeTabGroupId: null,
      terminals: {},
    });
    mockPanelEl = null;
    mockFocusTarget = { focus: vi.fn() };
    mockWorkspaceTile = { focus: vi.fn() };
  }

  function setupDom(opts: { panelInDom: boolean; focusedInPanel: boolean }) {
    mockPanelEl = opts.panelInDom
      ? { contains: vi.fn().mockReturnValue(opts.focusedInPanel) }
      : null;
    (document.querySelector as ReturnType<typeof vi.fn>).mockImplementation((sel: string) => {
      if (sel === '[data-terminal-panel]') return mockPanelEl;
      if (sel === '[data-terminal-panel] .xterm-helper-textarea') return mockFocusTarget;
      if (sel === '.mosaic-tile .xterm-helper-textarea') return mockWorkspaceTile;
      return null;
    });
  }

  beforeEach(resetPanel);

  it('hidden → show and focus panel', () => {
    setupDom({ panelInDom: false, focusedInPanel: false });

    executeAppCommand({ command: 'toggle-terminal-panel' });

    expect(useTerminalPanelStore.getState().panelVisible).toBe(true);
    expect(mockFocusTarget.focus).toHaveBeenCalled();
  });

  it('visible + focused → hide and focus workspace', () => {
    useTerminalPanelStore.setState({ panelVisible: true });
    setupDom({ panelInDom: true, focusedInPanel: true });

    executeAppCommand({ command: 'toggle-terminal-panel' });

    expect(useTerminalPanelStore.getState().panelVisible).toBe(false);
    expect(mockWorkspaceTile.focus).toHaveBeenCalled();
  });

  it('visible + not focused → focus panel without hiding', () => {
    useTerminalPanelStore.setState({ panelVisible: true });
    setupDom({ panelInDom: true, focusedInPanel: false });

    executeAppCommand({ command: 'toggle-terminal-panel' });

    expect(useTerminalPanelStore.getState().panelVisible).toBe(true);
    expect(mockFocusTarget.focus).toHaveBeenCalled();
  });

  it('full cycle: hidden → show → hide', () => {
    // Step 1: hidden → show
    setupDom({ panelInDom: false, focusedInPanel: false });
    executeAppCommand({ command: 'toggle-terminal-panel' });
    expect(useTerminalPanelStore.getState().panelVisible).toBe(true);

    // Step 2: visible + focused → hide
    setupDom({ panelInDom: true, focusedInPanel: true });
    executeAppCommand({ command: 'toggle-terminal-panel' });
    expect(useTerminalPanelStore.getState().panelVisible).toBe(false);
  });

  it('click-away scenario: visible, focus outside → focus panel, then toggle again → hide', () => {
    // User opened panel, then clicked a session tile (focus left panel)
    useTerminalPanelStore.setState({ panelVisible: true });
    setupDom({ panelInDom: true, focusedInPanel: false });

    // Toggle 1: should focus panel, not hide
    executeAppCommand({ command: 'toggle-terminal-panel' });
    expect(useTerminalPanelStore.getState().panelVisible).toBe(true);
    expect(mockFocusTarget.focus).toHaveBeenCalled();

    // Toggle 2: now focused in panel → should hide
    setupDom({ panelInDom: true, focusedInPanel: true });
    executeAppCommand({ command: 'toggle-terminal-panel' });
    expect(useTerminalPanelStore.getState().panelVisible).toBe(false);
  });
});
