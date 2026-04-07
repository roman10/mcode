import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupMcodeMock } from '../mock-mcode';

// Stub window.mcode with a pty.write mock
const mcode = setupMcodeMock({ pty: { write: vi.fn(), onExit: vi.fn(() => vi.fn()) } });

// Mock terminal-registry with a fake Terminal that has a focus method
const mockFocus = vi.fn();
vi.mock('../../../../src/renderer/devtools/terminal-registry', () => ({
  terminalRegistry: new Map([['sess-1', { focus: mockFocus }]]),
}));

const { useSessionStore } = await import('../../../../src/renderer/stores/session-store');
const { useDialogStore } = await import('../../../../src/renderer/stores/dialog-store');
const { insertPromptText } = await import(
  '../../../../src/renderer/components/CommandPalette/prompt-library-utils'
);

describe('insertPromptText', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFocus.mockClear();
    mcode.pty.write.mockClear();
    useDialogStore.setState({ textInsertTarget: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes to pty and refocuses terminal for the active session', () => {
    useSessionStore.getState().selectSession('sess-1');

    const result = insertPromptText('hello world');

    expect(result).toBe(true);
    expect(mcode.pty.write).toHaveBeenCalledWith('sess-1', 'hello world');

    // Focus should not fire synchronously — it's deferred via setTimeout
    expect(mockFocus).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(mockFocus).toHaveBeenCalledOnce();
  });

  it('returns false and does not focus when no session is selected', () => {
    useSessionStore.getState().selectSession(null);

    const result = insertPromptText('text');

    expect(result).toBe(false);
    expect(mcode.pty.write).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(mockFocus).not.toHaveBeenCalled();
  });

  it('delegates to textInsertTarget and does NOT focus terminal', () => {
    const target = vi.fn();
    useDialogStore.setState({ textInsertTarget: target });
    useSessionStore.getState().selectSession('sess-1');

    const result = insertPromptText('dialog text');

    expect(result).toBe(true);
    expect(target).toHaveBeenCalledWith('dialog text');
    expect(mcode.pty.write).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(mockFocus).not.toHaveBeenCalled();
  });
});
