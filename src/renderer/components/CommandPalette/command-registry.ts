import type { MosaicNode } from 'react-mosaic-component';
import { getLeaves } from 'react-mosaic-component';
import type { SessionInfo } from '@shared/types';
import { KEYBOARD_SHORTCUTS } from '@shared/keyboard-shortcuts';
import { formatKeys } from '../../utils/format-shortcut';
import { executeAppCommand } from '../../utils/app-commands';
import { useLayoutStore } from '../../stores/layout-store';
import { useDialogStore } from '../../stores/dialog-store';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import { resolveActiveCwd } from '../../utils/session-actions';

export interface CommandEntry {
  id: string;
  label: string;
  category: 'General' | 'Session' | 'Layout';
  shortcut?: string;
  keywords?: string[];
  enabled: boolean;
  execute: () => void;
}

export interface CommandContext {
  sessions: Record<string, SessionInfo>;
  selectedSessionId: string | null;
  mosaicTree: MosaicNode<string> | null;
}

/** Map shortcut labels to formatted key display strings. */
function buildShortcutMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of KEYBOARD_SHORTCUTS) {
    map.set(s.label, formatKeys(s.keys, s.mod));
  }
  return map;
}

function hasTile(mosaicTree: MosaicNode<string> | null, sessionId: string): boolean {
  if (!mosaicTree) return false;
  return getLeaves(mosaicTree).includes(`session:${sessionId}`);
}

export function getCommands(ctx: CommandContext): CommandEntry[] {
  const shortcuts = buildShortcutMap();
  const { sessions, selectedSessionId, mosaicTree } = ctx;
  const selected = selectedSessionId ? sessions[selectedSessionId] : null;
  const selectedHasTile = selectedSessionId ? hasTile(mosaicTree, selectedSessionId) : false;

  const commands: CommandEntry[] = [
    // --- General ---
    {
      id: 'new-session',
      label: 'New Session',
      category: 'General',
      shortcut: shortcuts.get('New Session'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'new-session' }),
    },
    {
      id: 'new-codex-session',
      label: 'New Codex Session',
      category: 'General',
      keywords: ['codex', 'openai', 'agent'],
      enabled: true,
      execute: () => executeAppCommand({ command: 'new-session', sessionType: 'codex' }),
    },
    {
      id: 'new-gemini-session',
      label: 'New Gemini Session',
      category: 'General',
      keywords: ['gemini', 'google', 'agent'],
      enabled: true,
      execute: () => executeAppCommand({ command: 'new-session', sessionType: 'gemini' }),
    },
    {
      id: 'new-terminal',
      label: 'New Terminal',
      category: 'General',
      shortcut: shortcuts.get('New Terminal'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'new-terminal' }),
    },
    {
      id: 'new-task',
      label: 'New Task',
      category: 'General',
      shortcut: shortcuts.get('New Task'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'show-create-task' }),
    },
    {
      id: 'run-shell-command',
      label: 'Run Shell Command',
      category: 'General',
      shortcut: shortcuts.get('Run Shell Command'),
      keywords: ['shell', 'terminal', 'execute', 'run', 'command'],
      enabled: true,
      execute: () => executeAppCommand({ command: 'run-shell-command' }),
    },
    {
      id: 'show-settings',
      label: 'Settings',
      category: 'General',
      shortcut: shortcuts.get('Settings'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'show-settings' }),
    },
    {
      id: 'search-in-files',
      label: 'Search in Files',
      category: 'General',
      shortcut: shortcuts.get('Search in Files'),
      keywords: ['search', 'find', 'grep', 'ripgrep', 'content'],
      enabled: true,
      execute: () => executeAppCommand({ command: 'search-in-files' }),
    },
    {
      id: 'show-shortcuts',
      label: 'Keyboard Shortcuts',
      category: 'General',
      shortcut: shortcuts.get('Keyboard Shortcuts'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'show-keyboard-shortcuts' }),
    },
    {
      id: 'snippets-insert',
      label: 'Snippets: Insert',
      category: 'General',
      shortcut: shortcuts.get('Snippets'),
      keywords: ['snippet', 'template', 'prompt'],
      enabled: true,
      execute: () => executeAppCommand({ command: 'open-snippets' }),
    },
    {
      id: 'snippets-new',
      label: 'Snippets: New',
      category: 'General',
      keywords: ['snippet', 'template', 'prompt', 'create'],
      enabled: true,
      execute: () => {
        const cwd = resolveActiveCwd();
        window.mcode.snippets.create('user', cwd).then((filePath) => {
          useLayoutStore.getState().addFileViewer(filePath);
        }).catch(console.error);
      },
    },
    {
      id: 'snippets-open-folder',
      label: 'Snippets: Open Folder',
      category: 'General',
      keywords: ['snippet', 'template', 'prompt', 'folder', 'finder'],
      enabled: true,
      execute: () => {
        const cwd = resolveActiveCwd();
        window.mcode.snippets.openFolder('user', cwd).catch(console.error);
      },
    },

    // --- Layout ---
    {
      id: 'split-terminal-horizontal',
      label: 'Split Terminal Right',
      category: 'Layout',
      shortcut: shortcuts.get('Split Horizontal'),
      keywords: ['terminal', 'split', 'right', 'horizontal', 'panel'],
      enabled: !!useTerminalPanelStore.getState().activeTabGroupId,
      execute: () => executeAppCommand({ command: 'split-terminal-horizontal' }),
    },
    {
      id: 'split-terminal-vertical',
      label: 'Split Terminal Down',
      category: 'Layout',
      shortcut: shortcuts.get('Split Vertical'),
      keywords: ['terminal', 'split', 'down', 'vertical', 'panel'],
      enabled: !!useTerminalPanelStore.getState().activeTabGroupId,
      execute: () => executeAppCommand({ command: 'split-terminal-vertical' }),
    },
    {
      id: 'close-terminal',
      label: 'Close Terminal',
      category: 'Layout',
      shortcut: shortcuts.get('Kill & Close'),
      keywords: ['terminal', 'kill', 'close', 'panel'],
      enabled: !!useTerminalPanelStore.getState().getActiveTerminal(),
      execute: () => executeAppCommand({ command: 'close-terminal' }),
    },
    {
      id: 'cycle-terminal-tab-next',
      label: 'Next Terminal Tab',
      category: 'Layout',
      shortcut: shortcuts.get('Next Terminal Tab'),
      keywords: ['terminal', 'tab', 'next', 'cycle', 'panel'],
      enabled: (useTerminalPanelStore.getState().getActiveTabGroup()?.terminalIds.length ?? 0) > 1,
      execute: () => executeAppCommand({ command: 'cycle-terminal-tab', direction: 1 }),
    },
    {
      id: 'cycle-terminal-tab-prev',
      label: 'Previous Terminal Tab',
      category: 'Layout',
      shortcut: shortcuts.get('Previous Terminal Tab'),
      keywords: ['terminal', 'tab', 'previous', 'prev', 'cycle', 'panel'],
      enabled: (useTerminalPanelStore.getState().getActiveTabGroup()?.terminalIds.length ?? 0) > 1,
      execute: () => executeAppCommand({ command: 'cycle-terminal-tab', direction: -1 }),
    },
    {
      id: 'toggle-terminal-panel',
      label: 'Toggle Terminal Panel',
      category: 'Layout',
      shortcut: shortcuts.get('Toggle Terminal Panel'),
      keywords: ['terminal', 'panel', 'collapse', 'expand', 'bottom'],
      enabled: true,
      execute: () => executeAppCommand({ command: 'toggle-terminal-panel' }),
    },
    {
      id: 'toggle-sidebar',
      label: 'Toggle Sidebar',
      category: 'Layout',
      shortcut: shortcuts.get('Toggle Sidebar'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'toggle-sidebar' }),
    },
    {
      id: 'show-sessions',
      label: 'Show Sessions',
      category: 'Layout',
      shortcut: shortcuts.get('Show Sessions'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'switch-sidebar-tab', tab: 'sessions' }),
    },
    {
      id: 'show-stats',
      label: 'Show Stats',
      category: 'Layout',
      shortcut: shortcuts.get('Show Stats'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'switch-sidebar-tab', tab: 'stats' }),
    },
    {
      id: 'show-changes',
      label: 'Show Changes',
      category: 'Layout',
      shortcut: shortcuts.get('Show Changes'),
      keywords: ['git', 'diff', 'uncommitted'],
      enabled: true,
      execute: () => executeAppCommand({ command: 'switch-sidebar-tab', tab: 'changes' }),
    },
    {
      id: 'show-activity',
      label: 'Show Activity',
      category: 'Layout',
      shortcut: shortcuts.get('Show Activity'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'switch-sidebar-tab', tab: 'activity' }),
    },
    {
      id: 'switch-to-kanban',
      label: 'Switch to Kanban Board',
      category: 'Layout',
      keywords: ['kanban', 'board', 'view', 'layout'],
      enabled: useLayoutStore.getState().viewMode !== 'kanban',
      execute: () => executeAppCommand({ command: 'set-view-mode', mode: 'kanban' }),
    },
    {
      id: 'switch-to-tiles',
      label: 'Switch to Tiles',
      category: 'Layout',
      keywords: ['tiles', 'mosaic', 'view', 'layout'],
      enabled: useLayoutStore.getState().viewMode !== 'tiles',
      execute: () => executeAppCommand({ command: 'set-view-mode', mode: 'tiles' }),
    },
    {
      id: 'close-all-tiles',
      label: 'Close All Tiles',
      category: 'Layout',
      shortcut: shortcuts.get('Close All Tiles'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'close-all-tiles' }),
    },

    // --- Session ---
    {
      id: 'clear-all-attention',
      label: 'Clear All Attention',
      category: 'Session',
      shortcut: shortcuts.get('Clear All Attention'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'clear-all-attention' }),
    },

    // --- Context-dependent session actions ---
    {
      id: 'kill-session',
      label: 'Kill Session',
      category: 'Session',
      enabled: !!selected && selected.status !== 'ended',
      execute: () => {
        if (!selectedSessionId) return;
        window.mcode.sessions.kill(selectedSessionId).catch(console.error);
      },
    },
    {
      id: 'close-tile',
      label: 'Close Tile',
      category: 'Layout',
      shortcut: shortcuts.get('Close Tile'),
      enabled: selectedHasTile,
      execute: () => {
        if (!selectedSessionId) return;
        useLayoutStore.getState().removeTile(selectedSessionId);
        useLayoutStore.getState().persist();
      },
    },
    {
      id: 'split-horizontal',
      label: 'Split Horizontal',
      category: 'Layout',
      shortcut: shortcuts.get('Split Horizontal'),
      enabled: selectedHasTile,
      execute: () => {
        if (!selectedSessionId) return;
        useLayoutStore.getState().setSplitIntent({ anchorSessionId: selectedSessionId, direction: 'row' });
        useDialogStore.getState().setShowNewSessionDialog(true);
      },
    },
    {
      id: 'split-vertical',
      label: 'Split Vertical',
      category: 'Layout',
      shortcut: shortcuts.get('Split Vertical'),
      enabled: selectedHasTile,
      execute: () => {
        if (!selectedSessionId) return;
        useLayoutStore.getState().setSplitIntent({ anchorSessionId: selectedSessionId, direction: 'column' });
        useDialogStore.getState().setShowNewSessionDialog(true);
      },
    },
    {
      id: 'delete-session',
      label: 'Delete Session',
      category: 'Session',
      enabled: !!selected && selected.status === 'ended',
      execute: () => {
        if (!selectedSessionId) return;
        window.mcode.sessions.delete(selectedSessionId).catch(console.error);
      },
    },
  ];

  // Dynamic entries: jump to any session by name
  for (const session of Object.values(sessions)) {
    if (session.sessionType === 'terminal') continue;
    commands.push({
      id: `focus:${session.sessionId}`,
      label: session.label || 'Untitled',
      category: 'Session',
      keywords: [session.cwd, session.sessionType],
      enabled: true,
      execute: () => {
        useLayoutStore.getState().addTile(session.sessionId);
        useLayoutStore.getState().persist();
        useLayoutStore.getState().focusTile(`session:${session.sessionId}`);
      },
    });
  }

  return commands;
}
