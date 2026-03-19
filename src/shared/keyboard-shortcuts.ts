export interface ShortcutEntry {
  label: string;
  keys: string;
  mod: boolean;
  category: 'general' | 'sessions' | 'terminal' | 'search';
}

export const SHORTCUT_CATEGORIES = [
  { id: 'general' as const, label: 'General' },
  { id: 'sessions' as const, label: 'Sessions' },
  { id: 'terminal' as const, label: 'Terminal' },
  { id: 'search' as const, label: 'Search' },
];

export const KEYBOARD_SHORTCUTS: ShortcutEntry[] = [
  // General
  { label: 'New Session', keys: 'N', mod: true, category: 'general' },
  { label: 'New Terminal', keys: 'T', mod: true, category: 'general' },
  { label: 'Toggle Sidebar', keys: '\\', mod: true, category: 'general' },
  { label: 'Keyboard Shortcuts', keys: '/', mod: true, category: 'general' },
  { label: 'Settings', keys: ',', mod: true, category: 'general' },
  { label: 'Toggle Dashboard', keys: 'Shift+A', mod: true, category: 'general' },
  { label: 'Toggle Commit Stats', keys: 'Shift+B', mod: true, category: 'general' },
  { label: 'Clear All Attention', keys: 'Shift+M', mod: true, category: 'general' },
  { label: 'Close All Tiles', keys: 'Shift+X', mod: true, category: 'general' },
  { label: 'Quick Open', keys: 'P', mod: true, category: 'general' },
  { label: 'Command Palette', keys: 'Shift+P', mod: true, category: 'general' },
  { label: 'Close Tile', keys: 'W', mod: true, category: 'general' },

  // Sessions
  { label: 'Focus Session 1–9', keys: '1 – 9', mod: true, category: 'sessions' },
  { label: 'Next Session', keys: ']', mod: true, category: 'sessions' },
  { label: 'Previous Session', keys: '[', mod: true, category: 'sessions' },

  // Terminal
  { label: 'Copy', keys: 'C', mod: true, category: 'terminal' },
  { label: 'Select All', keys: 'A', mod: true, category: 'terminal' },
  { label: 'Clear Terminal', keys: 'K', mod: true, category: 'terminal' },
  { label: 'Find', keys: 'F', mod: true, category: 'terminal' },
  { label: 'Kill & Close', keys: 'Shift+W', mod: true, category: 'terminal' },
  { label: 'Split Horizontal', keys: 'D', mod: true, category: 'terminal' },
  { label: 'Split Vertical', keys: 'Shift+D', mod: true, category: 'terminal' },
  { label: 'Toggle Maximize', keys: 'Enter', mod: true, category: 'terminal' },
  { label: 'Zoom In', keys: '=', mod: true, category: 'terminal' },
  { label: 'Zoom Out', keys: '-', mod: true, category: 'terminal' },
  { label: 'Reset Zoom', keys: '0', mod: true, category: 'terminal' },

  // Search (when search bar is open)
  { label: 'Next Result', keys: 'Enter', mod: false, category: 'search' },
  { label: 'Previous Result', keys: 'Shift+Enter', mod: false, category: 'search' },
  { label: 'Next Result', keys: 'G', mod: true, category: 'search' },
  { label: 'Previous Result', keys: 'Shift+G', mod: true, category: 'search' },
  { label: 'Close Search', keys: 'Escape', mod: false, category: 'search' },
];
