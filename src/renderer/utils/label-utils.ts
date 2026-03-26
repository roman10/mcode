import { CLAUDE_ICON, CODEX_ICON } from '@shared/constants';
import type { SessionType } from '@shared/types';

/**
 * Normalize an agent terminal title by replacing its spinner/status prefix
 * with the canonical agent icon. Called at capture time so the DB stays clean.
 */
export function normalizeAgentLabel(title: string, sessionType: SessionType): string {
  if (sessionType === 'claude') {
    return title.replace(/^[\u2800-\u28FF\u2733]\s*/, `${CLAUDE_ICON} `);
  }
  if (sessionType === 'codex') {
    return title.startsWith(CODEX_ICON) ? title : `${CODEX_ICON} ${title}`;
  }
  return title;
}

/**
 * Split a session label into an optional leading emoji icon and the text body.
 * The icon (e.g. ✳ from Claude Code, ❂ from Codex) is displayed separately
 * so it survives renames.
 */
export function splitLabelIcon(label: string): [icon: string, text: string] {
  // Claude icon: Braille spinners (U+2800-U+28FF) or canonical ✳ (U+2733)
  const claudeMatch = label.match(/^([\u2800-\u28FF\u2733])\s*/);
  if (claudeMatch) {
    return [CLAUDE_ICON, label.slice(claudeMatch[0].length)];
  }

  // Codex icon: ❂ (U+2742)
  if (label.startsWith(CODEX_ICON)) {
    return [CODEX_ICON, label.slice(1).trimStart()];
  }

  return ['', label];
}
