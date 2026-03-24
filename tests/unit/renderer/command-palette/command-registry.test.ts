import { describe, it, expect, vi } from 'vitest';

vi.stubGlobal('window', {
  mcode: {
    app: { getPlatform: () => 'darwin' },
    layout: { save: vi.fn().mockResolvedValue(undefined), load: vi.fn().mockResolvedValue(null) },
    preferences: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
    sessions: { clearAttention: vi.fn().mockResolvedValue(undefined) },
  },
});

const { getCommands } = await import('../../../../src/renderer/command-palette/command-registry');

const emptyCtx = {
  sessions: {},
  selectedSessionId: null,
  mosaicTree: null,
};

describe('command-registry', () => {
  it('includes toggle-terminal-panel command', () => {
    const commands = getCommands(emptyCtx);
    const cmd = commands.find((c) => c.id === 'toggle-terminal-panel');
    expect(cmd).toBeDefined();
    expect(cmd!.label).toBe('Toggle Terminal Panel');
    expect(cmd!.category).toBe('Layout');
    expect(cmd!.enabled).toBe(true);
    expect(cmd!.shortcut).toBeDefined();
  });

  it('toggle-terminal-panel has correct shortcut display on macOS', () => {
    const commands = getCommands(emptyCtx);
    const cmd = commands.find((c) => c.id === 'toggle-terminal-panel')!;
    // On macOS (mocked as darwin), Ctrl+ should render as ⌃
    expect(cmd.shortcut).toBe('⌃`');
  });
});
