import type { MosaicNode } from 'react-mosaic-component';
import { getLeaves } from 'react-mosaic-component';
import type { SessionInfo } from '../../shared/types';
import { KEYBOARD_SHORTCUTS } from '../../shared/keyboard-shortcuts';
import { formatKeys } from '../utils/format-shortcut';
import { executeAppCommand } from '../utils/app-commands';
import { useLayoutStore } from '../stores/layout-store';
import { useSessionStore } from '../stores/session-store';

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
      id: 'new-terminal',
      label: 'New Terminal',
      category: 'General',
      shortcut: shortcuts.get('New Terminal'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'new-terminal' }),
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
      id: 'show-shortcuts',
      label: 'Keyboard Shortcuts',
      category: 'General',
      shortcut: shortcuts.get('Keyboard Shortcuts'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'show-keyboard-shortcuts' }),
    },

    // --- Layout ---
    {
      id: 'toggle-sidebar',
      label: 'Toggle Sidebar',
      category: 'Layout',
      shortcut: shortcuts.get('Toggle Sidebar'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'toggle-sidebar' }),
    },
    {
      id: 'toggle-dashboard',
      label: 'Toggle Dashboard',
      category: 'Layout',
      shortcut: shortcuts.get('Toggle Dashboard'),
      enabled: true,
      execute: () => executeAppCommand({ command: 'toggle-dashboard' }),
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
        useLayoutStore.getState().setShowNewSessionDialog(true);
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
        useLayoutStore.getState().setShowNewSessionDialog(true);
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
    if (session.ephemeral) continue;
    commands.push({
      id: `focus:${session.sessionId}`,
      label: session.label || 'Untitled',
      category: 'Session',
      keywords: [session.cwd, session.sessionType],
      enabled: true,
      execute: () => {
        useLayoutStore.getState().addTile(session.sessionId);
        useLayoutStore.getState().persist();
        useSessionStore.getState().selectSession(session.sessionId);
      },
    });
  }

  return commands;
}
