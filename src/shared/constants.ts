export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;
export const TERMINAL_FONT_SIZE = 13;
export const TERMINAL_FONT_FAMILY = "'JetBrains Mono', 'Fira Code', monospace";

/**
 * Per-terminal font family that isolates each terminal's WebGL texture atlas.
 *
 * `@xterm/addon-webgl` keeps a process-global `TextureAtlas` cache and shares
 * one atlas across every terminal whose font/theme config is byte-equal
 * (`acquireTextureAtlas` / `configEquals`, which compares `fontFamily` by
 * exact string). A shared CPU-side atlas corrupts the GPU textures of
 * terminals that aren't actively redrawing (stale UVs → garbled glyphs).
 *
 * Prefixing the family list with a unique, quoted, non-existent family makes
 * each terminal's config unique → a private atlas per terminal. Per the CSS
 * font spec the unknown family is skipped by fallback, so rasterization is
 * byte-identical to using TERMINAL_FONT_FAMILY directly. The sessionId is
 * sanitized to a safe identifier; quoting keeps the `ctx.font` shorthand
 * parseable regardless of its contents.
 */
export function atlasIsolatedFontFamily(sessionId: string): string {
  const token = sessionId.replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
  return `"mcode-atlas-${token}", ${TERMINAL_FONT_FAMILY}`;
}
export const PTY_KILL_TIMEOUT_MS = 3000;
export const RING_BUFFER_MAX_BYTES = 512 * 1024; // ~512KB per session
/** Tail size requested by `getReplayDataTail` on the polling hot path.
 *  Every poll consumer caps its effective scan at the last 2000 chars
 *  (see prompt-detect.ts), so 8 KB UTF-8 (≥ 2048 chars worst case) is
 *  ample headroom while keeping the per-tick decode 64× cheaper than
 *  `getReplayData`'s full ~512 KB window. */
export const POLL_TAIL_BYTES = 8 * 1024;
export const BROKER_AUTO_SHUTDOWN_DELAY_MS = 30_000; // 30s idle before broker exits
export const DEFAULT_SCROLLBACK_LINES = 5000;
export const MAX_SCROLLBACK_LINES = 20000;
export const SCROLLBACK_PRESETS = [1000, 2500, 5000, 10000, 20000] as const;
/** After this many ms hidden, dispose the xterm.js Terminal entirely to free its scrollback.
 *  On reveal, the terminal is recreated and replays the broker ring buffer (~512 KB tail). */
export const HIDDEN_TILE_DISPOSE_MS = 5 * 60 * 1000;
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

// Antigravity (agy) permission modes. 'sandbox' → --sandbox; 'skipPermissions' →
// --dangerously-skip-permissions. The implicit "ask each tool" state is the unset
// default (no flag), mirroring how Claude treats absence of a --permission-mode.
export const AGY_PERMISSION_MODES = ['sandbox', 'skipPermissions'] as const;

// Union of all agent permission modes
export const PERMISSION_MODES = [...CLAUDE_PERMISSION_MODES, ...COPILOT_PERMISSION_MODES, ...CODEX_PERMISSION_MODES, ...GEMINI_PERMISSION_MODES, ...AGY_PERMISSION_MODES] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Which permission modes each agent supports. Absence = no support. */
export const AGENT_PERMISSION_MODES: Partial<Record<string, readonly PermissionMode[]>> = {
  claude: [...CLAUDE_PERMISSION_MODES],
  copilot: [...COPILOT_PERMISSION_MODES],
  codex: [...CODEX_PERMISSION_MODES],
  gemini: ['plan', ...GEMINI_PERMISSION_MODES],
  agy: [...AGY_PERMISSION_MODES],
};

/** Default (most permissive) permission mode for each agent when no last-used value exists. */
export const DEFAULT_AGENT_PERMISSION_MODE: Partial<Record<string, PermissionMode>> = {
  claude: 'auto',
  codex: 'fullAuto',
  copilot: 'autopilot',
  gemini: 'autoEdit',
  agy: 'skipPermissions',
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
  sandbox: 'Sandbox',
  skipPermissions: 'Skip Permissions',
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

// Antigravity (agy) icon, U+2756, used as session label prefix for Antigravity CLI sessions
export const AGY_ICON = '\u2756';

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

// Cross-CLI session handoff
/** Hard cap on the seed text passed as initialPrompt to the target CLI.
 *  CLI args are bounded by ARG_MAX (~1MB on macOS); we leave generous headroom. */
export const HANDOFF_SEED_MAX_CHARS = 100_000;

/** Prompt fed to the chosen CLI in headless one-shot mode to produce a handoff summary. */
export const HANDOFF_COMPACTION_PROMPT = [
  'You are summarising a coding session so it can be continued in a different AI coding CLI.',
  'Below is the conversation transcript. Produce a concise handoff summary covering:',
  '1. The user\'s overall goal and current sub-task.',
  '2. Decisions already made and approaches ruled out.',
  '3. Key files / functions touched and what changed.',
  '4. Open questions or next steps.',
  'Write it as plain prose for another agent to read at the start of a new conversation.',
  'Do not invent details that are not in the transcript. No preamble — start with the summary.',
].join('\n');

// Auto-update
export const GITHUB_OWNER = 'roman10';
export const GITHUB_REPO = 'mcode';
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
export const UPDATE_CHECK_DELAY_MS = 10_000; // 10s after app launch
