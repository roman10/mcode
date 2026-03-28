import { CLAUDE_ICON } from '@shared/constants';
import { AGENT_SESSION_TYPES, getAgentDefinition } from '@shared/session-agents';
import type { SessionType } from '@shared/types';

/**
 * Normalize an agent terminal title by replacing its spinner/status prefix
 * with the canonical agent icon. Called at capture time so the DB stays clean.
 */
export function normalizeAgentLabel(title: string, sessionType: SessionType | string): string {
  if (sessionType === 'claude') {
    return title.replace(/^[\u2800-\u28FF\u2733]\s*/, `${CLAUDE_ICON} `);
  }

  const agent = getAgentDefinition(sessionType);
  if (agent) {
    return title.startsWith(agent.icon) ? title : `${agent.icon} ${title}`;
  }

  return title;
}

/**
 * Split a session label into an optional leading emoji icon and the text body.
 * The icon (e.g. ✳ from Claude Code, ❂ from Codex, ✦ from Gemini) is displayed separately
 * so it survives renames.
 */
export function splitLabelIcon(label: string): [icon: string, text: string] {
  // Claude icon: Braille spinners (U+2800-U+28FF) or canonical ✳ (U+2733)
  const claudeMatch = label.match(/^([\u2800-\u28FF\u2733])\s*/);
  if (claudeMatch) {
    return [CLAUDE_ICON, label.slice(claudeMatch[0].length)];
  }

  for (const sessionType of AGENT_SESSION_TYPES) {
    if (sessionType === 'claude') continue;
    const agent = getAgentDefinition(sessionType);
    if (agent && label.startsWith(agent.icon)) {
      return [agent.icon, label.slice(agent.icon.length).trimStart()];
    }
  }

  return ['', label];
}
