import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.stubGlobal('window', {
  mcode: {
    app: { getPlatform: () => 'darwin' },
    layout: { save: vi.fn().mockResolvedValue(undefined), load: vi.fn().mockResolvedValue(null) },
    preferences: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
    sessions: { clearAttention: vi.fn().mockResolvedValue(undefined) },
  },
});

const { useLayoutStore } = await import('../../../../src/renderer/stores/layout-store');
const { executeAppCommand } = await import('../../../../src/renderer/utils/app-commands');

describe('new-session app commands', () => {
  beforeEach(() => {
    useLayoutStore.setState({
      showNewSessionDialog: false,
      newSessionDialogType: 'claude',
    });
  });

  it('opens the dialog in Claude mode by default', () => {
    executeAppCommand({ command: 'new-session' });
    const state = useLayoutStore.getState();
    expect(state.showNewSessionDialog).toBe(true);
    expect(state.newSessionDialogType).toBe('claude');
  });

  it('opens the dialog in Codex mode when requested', () => {
    executeAppCommand({ command: 'new-session', sessionType: 'codex' });
    const state = useLayoutStore.getState();
    expect(state.showNewSessionDialog).toBe(true);
    expect(state.newSessionDialogType).toBe('codex');
  });
});
