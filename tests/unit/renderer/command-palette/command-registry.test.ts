import { describe, it, expect, vi } from 'vitest';

vi.stubGlobal('window', {
  mcode: {
    app: { getPlatform: () => 'darwin' },
    layout: { save: vi.fn().mockResolvedValue(undefined), load: vi.fn().mockResolvedValue(null) },
    preferences: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
    sessions: { clearAttention: vi.fn().mockResolvedValue(undefined) },
  },
});

const { getCommands } = await import('../../../../src/renderer/components/CommandPalette/command-registry');

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

  it('show-sessions has correct shortcut on macOS', () => {
    const commands = getCommands(emptyCtx);
    const cmd = commands.find((c) => c.id === 'show-sessions');
    expect(cmd).toBeDefined();
    expect(cmd!.shortcut).toBe('⌘⇧O');
  });

  it('includes show-stats and not show-commits or show-tokens', () => {
    const commands = getCommands(emptyCtx);
    const ids = commands.map((c) => c.id);
    expect(ids).toContain('show-stats');
    expect(ids).not.toContain('show-commits');
    expect(ids).not.toContain('show-tokens');
  });

  it('includes New Codex Session in the General category', () => {
    const commands = getCommands(emptyCtx);
    const cmd = commands.find((c) => c.id === 'new-codex-session');
    expect(cmd).toBeDefined();
    expect(cmd!.label).toBe('New Codex Session');
    expect(cmd!.category).toBe('General');
    expect(cmd!.enabled).toBe(true);
    expect(cmd!.keywords).toContain('codex');
  });

  it('includes New Copilot Session in the General category', () => {
    const commands = getCommands(emptyCtx);
    const cmd = commands.find((c) => c.id === 'new-copilot-session');
    expect(cmd).toBeDefined();
    expect(cmd!.label).toBe('New Copilot Session');
    expect(cmd!.category).toBe('General');
    expect(cmd!.enabled).toBe(true);
    expect(cmd!.keywords).toContain('copilot');
  });

  it('toggle-terminal-panel has correct shortcut display on macOS', () => {
    const commands = getCommands(emptyCtx);
    const cmd = commands.find((c) => c.id === 'toggle-terminal-panel')!;
    // On macOS (mocked as darwin), Ctrl+ should render as ⌃
    expect(cmd.shortcut).toBe('⌃`');
  });

  describe('terminal panel commands', () => {
    it('includes all five new terminal panel commands', () => {
      const commands = getCommands(emptyCtx);
      const ids = commands.map((c) => c.id);
      expect(ids).toContain('split-terminal-horizontal');
      expect(ids).toContain('split-terminal-vertical');
      expect(ids).toContain('close-terminal');
      expect(ids).toContain('cycle-terminal-tab-next');
      expect(ids).toContain('cycle-terminal-tab-prev');
    });

    it('has correct labels', () => {
      const commands = getCommands(emptyCtx);
      const find = (id: string) => commands.find((c) => c.id === id)!;
      expect(find('split-terminal-horizontal').label).toBe('Split Terminal Right');
      expect(find('split-terminal-vertical').label).toBe('Split Terminal Down');
      expect(find('close-terminal').label).toBe('Close Terminal');
      expect(find('cycle-terminal-tab-next').label).toBe('Next Terminal Tab');
      expect(find('cycle-terminal-tab-prev').label).toBe('Previous Terminal Tab');
    });

    it('all belong to the Layout category', () => {
      const commands = getCommands(emptyCtx);
      const terminalCmds = commands.filter((c) =>
        ['split-terminal-horizontal', 'split-terminal-vertical', 'close-terminal',
          'cycle-terminal-tab-next', 'cycle-terminal-tab-prev'].includes(c.id),
      );
      expect(terminalCmds).toHaveLength(5);
      for (const cmd of terminalCmds) {
        expect(cmd.category).toBe('Layout');
      }
    });

    it('shows correct macOS shortcut hints', () => {
      const commands = getCommands(emptyCtx);
      const find = (id: string) => commands.find((c) => c.id === id)!;
      expect(find('split-terminal-horizontal').shortcut).toBe('⌘D');
      expect(find('split-terminal-vertical').shortcut).toBe('⌘⇧D');
      expect(find('close-terminal').shortcut).toBe('⌘⇧W');
      expect(find('cycle-terminal-tab-next').shortcut).toBe('⌘]');
      expect(find('cycle-terminal-tab-prev').shortcut).toBe('⌘[');
    });

    it('split and cycle commands are disabled when no terminal panel is open', () => {
      // Store starts empty — no activeTabGroupId, no active terminal
      const commands = getCommands(emptyCtx);
      const find = (id: string) => commands.find((c) => c.id === id)!;
      expect(find('split-terminal-horizontal').enabled).toBe(false);
      expect(find('split-terminal-vertical').enabled).toBe(false);
      expect(find('close-terminal').enabled).toBe(false);
      expect(find('cycle-terminal-tab-next').enabled).toBe(false);
      expect(find('cycle-terminal-tab-prev').enabled).toBe(false);
    });
  });
});
