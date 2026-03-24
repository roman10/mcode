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

const { useLayoutStore } = await import('../../../../src/renderer/stores/layout-store');
const { useSessionStore } = await import('../../../../src/renderer/stores/session-store');
const { executeAppCommand } = await import('../../../../src/renderer/utils/app-commands');

function resetStores() {
  useLayoutStore.setState({
    mosaicTree: null,
    viewMode: 'tiles',
    kanbanExpandedSessionId: null,
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
