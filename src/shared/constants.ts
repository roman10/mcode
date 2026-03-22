export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;
export const TERMINAL_FONT_SIZE = 13;
export const TERMINAL_FONT_FAMILY = "'JetBrains Mono', 'Fira Code', monospace";
export const PTY_KILL_TIMEOUT_MS = 3000;
export const RING_BUFFER_MAX_BYTES = 100 * 1024; // ~100KB per session
export const DEFAULT_SCROLLBACK_LINES = 5000;
export const SCROLLBACK_PRESETS = [1000, 5000, 10_000, 50_000, 0] as const; // 0 = unlimited
export const DEFAULT_SIDEBAR_WIDTH = 280;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 500;
export const LAYOUT_PERSIST_DEBOUNCE_MS = 500;

// Valid Claude Code --permission-mode values (excluding 'default' which means "no flag")
export const PERMISSION_MODES = [
  'plan',
  'acceptEdits',
  'auto',
  'dontAsk',
  'bypassPermissions',
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

// Valid Claude Code --effort values (excluding 'default' which means "no flag")
export const EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'max',
] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

// Hook system
export const HOOK_PORT_DEFAULT = 7777;
export const HOOK_PORT_MAX = 7799;
export const HOOK_EVENT_RETENTION_DAYS = 7;
export const HOOK_TOOL_INPUT_MAX_BYTES = 4096;
export const HOOK_PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export const KNOWN_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'PermissionRequest',
  'SessionStart',
  'SessionEnd',
  'Notification',
] as const;
export type KnownHookEvent = (typeof KNOWN_HOOK_EVENTS)[number];

// Auto-update
export const GITHUB_OWNER = 'anthropics'; // TODO: set to actual owner when repo goes public
export const GITHUB_REPO = 'mcode';       // TODO: set to actual repo name
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
export const UPDATE_CHECK_DELAY_MS = 10_000; // 10s after app launch
