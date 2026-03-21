import { stripAnsi } from '../shared/strip-ansi';

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
  // Status bar is short (< 300 chars) and at most 2 newlines.
  // Reject if there is substantial multi-line content (Claude still outputting).
  return after.length < 300 && (after.match(/\n/g) || []).length <= 2;
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
 * We detect the pattern: ❯ followed by "N." (a digit and period) within
 * the last portion of the buffer.
 */
export function isAtUserChoice(rawBufferTail: string): boolean {
  const clean = stripAnsi(rawBufferTail);
  // Look for ❯ followed by a numbered option (e.g. "❯ 1.")
  const menuPattern = /❯\s+\d+\./;
  const lastChunk = clean.slice(-500);
  return menuPattern.test(lastChunk);
}
