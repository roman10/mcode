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
  { label: 'Show Sessions', keys: 'Shift+O', mod: true, category: 'general' },
  { label: 'Show Activity', keys: 'Shift+A', mod: true, category: 'general' },
  { label: 'Show Stats', keys: 'Shift+B', mod: true, category: 'general' },
  { label: 'Show Changes', keys: 'Shift+C', mod: true, category: 'general' },
  { label: 'Refresh Stats', keys: 'R', mod: true, category: 'general' },
  { label: 'Clear All Attention', keys: 'Shift+M', mod: true, category: 'general' },
  { label: 'Toggle Layout Mode', keys: 'Shift+L', mod: true, category: 'general' },
  { label: 'Close All Tiles', keys: 'Shift+X', mod: true, category: 'general' },
  { label: 'Quick Open', keys: 'P', mod: true, category: 'general' },
  { label: 'Command Palette', keys: 'Shift+P', mod: true, category: 'general' },
  { label: 'New Task', keys: 'Shift+T', mod: true, category: 'general' },
  { label: 'Run Shell Command', keys: 'Shift+E', mod: true, category: 'general' },
  { label: 'Search in Files', keys: 'Shift+F', mod: true, category: 'general' },
  { label: 'Snippets', keys: 'Shift+S', mod: true, category: 'general' },
  { label: 'Toggle Terminal Panel', keys: 'Ctrl+`', mod: false, category: 'general' },
  { label: 'Close Tile', keys: 'W', mod: true, category: 'general' },

  // Sessions
  { label: 'Focus Session 1–9', keys: '1 – 9', mod: true, category: 'sessions' },
  { label: 'Next Session', keys: ']', mod: true, category: 'sessions' },
  { label: 'Previous Session', keys: '[', mod: true, category: 'sessions' },
  { label: 'Rename Session', keys: 'F2', mod: false, category: 'sessions' },
  { label: 'Open Session Tile', keys: 'Enter', mod: false, category: 'sessions' },
  { label: 'Kill / Delete Session', keys: '⌫', mod: false, category: 'sessions' },
  { label: 'Filter Sessions', keys: 'F', mod: true, category: 'sessions' },

  // Terminal
  { label: 'Copy', keys: 'C', mod: true, category: 'terminal' },
  { label: 'Select All', keys: 'A', mod: true, category: 'terminal' },
  { label: 'Clear Terminal', keys: 'K', mod: true, category: 'terminal' },
  { label: 'Find', keys: 'F', mod: true, category: 'terminal' },
  { label: 'Kill & Close', keys: 'Shift+W', mod: true, category: 'terminal' },
  { label: 'Split Horizontal', keys: 'D', mod: true, category: 'terminal' },
  { label: 'Split Vertical', keys: 'Shift+D', mod: true, category: 'terminal' },
  { label: 'Toggle Maximize', keys: 'Enter', mod: true, category: 'terminal' },
  { label: 'Toggle Auto-close', keys: 'Shift+Q', mod: true, category: 'terminal' },
  { label: 'Zoom In', keys: '=', mod: true, category: 'terminal' },
  { label: 'Zoom Out', keys: '-', mod: true, category: 'terminal' },
  { label: 'Reset Zoom', keys: '0', mod: true, category: 'terminal' },
  { label: 'Rename Terminal', keys: 'F2', mod: false, category: 'terminal' },
  { label: 'Next Terminal Tab', keys: ']', mod: true, category: 'terminal' },
  { label: 'Previous Terminal Tab', keys: '[', mod: true, category: 'terminal' },

  // Search (when search bar is open)
  { label: 'Next Result', keys: 'Enter', mod: false, category: 'search' },
  { label: 'Previous Result', keys: 'Shift+Enter', mod: false, category: 'search' },
  { label: 'Next Result', keys: 'G', mod: true, category: 'search' },
  { label: 'Previous Result', keys: 'Shift+G', mod: true, category: 'search' },
  { label: 'Close Search', keys: 'Escape', mod: false, category: 'search' },
];
