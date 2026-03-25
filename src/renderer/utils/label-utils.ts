import { CLAUDE_ICON } from '@shared/constants';

/**
 * Normalize a Claude Code terminal title by replacing its spinner/status
 * prefix (✳ idle, Braille U+2800–U+28FF animation frames) with a single
 * canonical ✳ icon.  Called at capture time so the DB stays clean.
 */
export function normalizeClaudeLabel(title: string): string {
  return title.replace(/^[\u2800-\u28FF\u2733]\s*/, `${CLAUDE_ICON} `);
}

/**
 * Split a session label into an optional leading emoji icon and the text body.
 * The icon (e.g. ✳ from Claude Code) is displayed separately so it survives renames.
 * Also handles legacy Braille spinner artifacts stored before normalizeClaudeLabel existed.
 */
export function splitLabelIcon(label: string): [icon: string, text: string] {
  const match = label.match(/^([\u2800-\u28FF\u2733])\s*/);
  if (match) {
    return [CLAUDE_ICON, label.slice(match[0].length)];
  }
  return ['', label];
}
