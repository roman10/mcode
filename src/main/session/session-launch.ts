import { getAgentDefinition } from '../../shared/session-agents';
import type { SessionType } from '../../shared/types';

export function truncatePromptToLabel(prompt: string, maxLen: number): string {
  const firstLine = prompt.split('\n')[0].trim();
  if (!firstLine) return '';
  if (firstLine.length <= maxLen) return firstLine;
  const truncated = firstLine.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.3 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

export function prefixSessionLabel(rawLabel: string, sessionType: SessionType | string): string {
  if (sessionType === 'claude') {
    return /^[\u2800-\u28FF\u2733]\s*/.test(rawLabel)
      ? rawLabel
      : `${getAgentDefinition('claude')?.icon ?? ''} ${rawLabel}`.trim();
  }

  const agent = getAgentDefinition(sessionType);
  if (!agent) return rawLabel;
  return rawLabel.startsWith(agent.icon) ? rawLabel : `${agent.icon} ${rawLabel}`;
}

export function buildSessionLabel(input: {
  sessionType: SessionType;
  userLabel?: string | null;
  initialPrompt?: string;
  nextDisambiguatedLabel(): string;
  promptMaxLength?: number;
}): { label: string; labelSource: 'user' | 'auto' } {
  const { sessionType, userLabel, initialPrompt, nextDisambiguatedLabel, promptMaxLength = 50 } = input;
  if (userLabel) {
    return {
      label: prefixSessionLabel(userLabel, sessionType),
      labelSource: 'user',
    };
  }

  const autoLabel = (initialPrompt ? truncatePromptToLabel(initialPrompt, promptMaxLength) : '')
    || nextDisambiguatedLabel();

  return {
    label: sessionType === 'terminal' ? autoLabel : prefixSessionLabel(autoLabel, sessionType),
    labelSource: 'auto',
  };
}

export function getDefaultSessionCommand(sessionType: SessionType, shellCommand: string): string {
  if (sessionType === 'terminal') return shellCommand;
  return getAgentDefinition(sessionType)?.defaultCommand ?? 'claude';
}

