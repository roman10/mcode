import { stripAnsi } from '../../shared/strip-ansi';

const PERMISSION_PATTERNS = [
  /Allow\s+once/i,
  /Deny\s+once/i,
  /Allow\s+always/i,
] as const;

/**
 * Check if the terminal buffer tail shows Claude Code's idle prompt (❯).
 * The raw ring buffer is a linear stream — cursor-repositioned content
 * (e.g. the status bar) appears AFTER the prompt character.  We therefore
 * look for the last ❯ and verify only a short tail follows it (status bar
 * is typically < 300 chars on a single line).
 */
export function isAtClaudePrompt(rawBufferTail: string): boolean {
  const clean = stripAnsi(rawBufferTail);
  const lastPrompt = clean.lastIndexOf('❯');
  if (lastPrompt === -1) return false;
  const after = clean.slice(lastPrompt + 1);
  // Status bar uses ANSI cursor repositioning; after stripping, each
  // update adds ~80-100 chars to the linear buffer.  Allow up to 800
  // chars / 5 newlines to tolerate accumulation while still rejecting
  // real Claude output (which is multi-line and much longer).
  return after.length < 800 && (after.match(/\n/g) || []).length <= 5;
}

/**
 * Check whether the terminal buffer tail contains a known permission prompt.
 *
 * These prompts can surface when hook transport is unavailable, so PTY polling
 * needs a text-based fallback to put the session into `waiting`.
 */
export function hasPermissionPrompt(rawBufferTail: string): boolean {
  const clean = stripAnsi(rawBufferTail.slice(-2000));
  return PERMISSION_PATTERNS.some((re) => re.test(clean));
}

/**
 * Codex's TUI approval menu uses different wording from Claude's (no
 * "Allow once / Deny once"), so the generic `hasPermissionPrompt` never
 * matches a Codex prompt. These anchor on the menu header and the two
 * fixed option labels Codex renders for every command-approval request:
 *
 *   Allow Codex to run `…`?
 *   ❯ 1. Yes, proceed
 *     2. Yes, and don't ask again for this command in this session
 *     3. No, and tell Codex what to do differently
 */
const CODEX_PERMISSION_PATTERNS = [
  /No,\s+and\s+tell\s+Codex/i,
  /Yes,\s+proceed/i,
  /Allow\s+Codex\s+to\s+run/i,
] as const;

/**
 * Check whether the terminal buffer tail contains a Codex command-approval
 * prompt. Used by the Codex PTY-polling fallback when hook transport is
 * unavailable (the live-hook path reports approvals directly).
 */
export function hasCodexPermissionPrompt(rawBufferTail: string): boolean {
  const clean = stripAnsi(rawBufferTail.slice(-2000));
  return CODEX_PERMISSION_PATTERNS.some((re) => re.test(clean));
}

/**
 * Check if the terminal buffer tail shows a Claude Code user-choice menu
 * (e.g. ExitPlanMode or AskUserQuestion).  These menus use ❯ as a cursor
 * next to numbered options like:
 *
 *   ❯ 1. Yes, and bypass permissions
 *     2. Yes, manually approve edits
 *     3. Type here to tell Claude what to change
 *
 * We detect the pattern by anchoring on the last ❯ in the buffer (same
 * strategy as isAtClaudePrompt) and checking if it's followed by "N.".
 */
export function isAtUserChoice(rawBufferTail: string): boolean {
  const clean = stripAnsi(rawBufferTail);
  // Anchor on the last ❯ — same strategy as isAtClaudePrompt.
  // Status bar writes appear after the ❯ in the linear buffer but never
  // add new ❯ characters, so lastIndexOf reliably finds the menu cursor
  // (or the idle prompt if the user dismissed the menu with Esc).
  const lastPrompt = clean.lastIndexOf('❯');
  if (lastPrompt === -1) return false;
  const afterPrompt = clean.slice(lastPrompt, lastPrompt + 50);
  return /❯\s+\d+\./.test(afterPrompt);
}

/**
 * Parse the numbered options from a Claude Code user-choice menu.
 * Returns an array of {index, text} entries, e.g.:
 *   [{ index: 1, text: 'Yes, and bypass permissions' },
 *    { index: 2, text: 'Yes, manually approve edits' },
 *    { index: 3, text: '' }]  // empty when hint text is stripped
 *
 * Used by the task queue to locate the text-input option for plan mode
 * response tasks.  The text-input option may have empty text when its
 * placeholder ("Tell Claude what to change") is rendered as ANSI hint
 * styling that gets stripped.
 */
export function parseUserChoices(rawBufferTail: string): { index: number; text: string }[] {
  const clean = stripAnsi(rawBufferTail.slice(-2000));
  const menuStart = clean.lastIndexOf('❯');
  if (menuStart === -1) return [];
  const menuBlock = clean.slice(menuStart);
  const matches = [...menuBlock.matchAll(/(\d+)\.\s*(.*)/g)];
  return matches.map((m) => ({ index: parseInt(m[1], 10), text: m[2].trim() }));
}
