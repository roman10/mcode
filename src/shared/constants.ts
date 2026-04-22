export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;
export const TERMINAL_FONT_SIZE = 13;
export const TERMINAL_FONT_FAMILY = "'JetBrains Mono', 'Fira Code', monospace";
export const PTY_KILL_TIMEOUT_MS = 3000;
export const RING_BUFFER_MAX_BYTES = 512 * 1024; // ~512KB per session
export const BROKER_AUTO_SHUTDOWN_DELAY_MS = 30_000; // 30s idle before broker exits
export const DEFAULT_SCROLLBACK_LINES = 5000;
export const SCROLLBACK_PRESETS = [1000, 5000, 10_000, 50_000, 0] as const; // 0 = unlimited
export const DEFAULT_SIDEBAR_WIDTH = 280;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 500;
export const LAYOUT_PERSIST_DEBOUNCE_MS = 500;

// Valid Claude Code --permission-mode values (excluding 'default' which means "no flag")
export const CLAUDE_PERMISSION_MODES = [
  'plan',
  'acceptEdits',
  'auto',
  'dontAsk',
  'bypassPermissions',
] as const;

// Valid Copilot CLI permission flags
export const COPILOT_PERMISSION_MODES = ['autopilot', 'allowAll'] as const;

// Valid Codex CLI permission presets
export const CODEX_PERMISSION_MODES = ['fullAuto', 'bypassAll'] as const;

// Gemini-unique approval modes ('plan' is shared with Claude via AGENT_PERMISSION_MODES)
export const GEMINI_PERMISSION_MODES = ['autoEdit', 'yolo'] as const;

// Union of all agent permission modes
export const PERMISSION_MODES = [...CLAUDE_PERMISSION_MODES, ...COPILOT_PERMISSION_MODES, ...CODEX_PERMISSION_MODES, ...GEMINI_PERMISSION_MODES] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Which permission modes each agent supports. Absence = no support. */
export const AGENT_PERMISSION_MODES: Partial<Record<string, readonly PermissionMode[]>> = {
  claude: [...CLAUDE_PERMISSION_MODES],
  copilot: [...COPILOT_PERMISSION_MODES],
  codex: [...CODEX_PERMISSION_MODES],
  gemini: ['plan', ...GEMINI_PERMISSION_MODES],
};

/** Default (most permissive) permission mode for each agent when no last-used value exists. */
export const DEFAULT_AGENT_PERMISSION_MODE: Partial<Record<string, PermissionMode>> = {
  claude: 'auto',
  codex: 'fullAuto',
  copilot: 'autopilot',
  gemini: 'autoEdit',
};

/** Human-readable labels for all permission modes. */
export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  plan: 'Plan',
  acceptEdits: 'Accept Edits',
  auto: 'Auto',
  dontAsk: "Don't Ask",
  bypassPermissions: 'Bypass Permissions',
  autopilot: 'Autopilot',
  allowAll: 'Allow All',
  fullAuto: 'Full Auto',
  bypassAll: 'Bypass All',
  autoEdit: 'Auto Edit',
  yolo: 'YOLO',
};

// Valid Claude Code --effort values (excluding 'default' which means "no flag")
export const EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

// Claude Code icon — canonical ✳ (U+2733), used as session label prefix
export const CLAUDE_ICON = '\u2733';

// Codex icon — ❂ (U+2742), used as session label prefix for Codex CLI sessions
export const CODEX_ICON = '\u2742';

// Gemini icon — ✦ (U+2726), used as session label prefix for Gemini CLI sessions
export const GEMINI_ICON = '\u2726';

// Copilot icon — ★ (U+2605), used as session label prefix for Copilot CLI sessions
export const COPILOT_ICON = '\u2605';

// Hook system
export const HOOK_PORT_DEFAULT = 7777;
export const HOOK_PORT_MAX = 7799;
export const HOOK_EVENT_RETENTION_DAYS = 7;
export const HOOK_TOOL_INPUT_MAX_BYTES = 4096;
export const HOOK_PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Events recognised by Claude Code's settings.json hook system.
export const CLAUDE_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'PermissionRequest',
  'SessionStart',
  'SessionEnd',
  'Notification',
  'UserPromptSubmit',
] as const;

// All hook events mcode understands, including Gemini-only events like BeforeModel.
export const KNOWN_HOOK_EVENTS = [
  ...CLAUDE_HOOK_EVENTS,
  'BeforeModel',
] as const;
export type KnownHookEvent = (typeof KNOWN_HOOK_EVENTS)[number];

// Auto-update
export const GITHUB_OWNER = 'roman10';
export const GITHUB_REPO = 'mcode';
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
export const UPDATE_CHECK_DELAY_MS = 10_000; // 10s after app launch
