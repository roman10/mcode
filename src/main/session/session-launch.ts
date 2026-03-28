import { getAgentDefinition } from '../../shared/session-agents';
import type { SessionCreateInput, SessionType } from '../../shared/types';

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

export function buildCreateSessionArgs(input: {
  session: SessionCreateInput;
  isTerminal: boolean;
  isCodex: boolean;
  codexBridgeReady: boolean;
}): string[] {
  const { session, isTerminal, isCodex, codexBridgeReady } = input;
  const args: string[] = [];

  if (isTerminal) {
    if (session.args) {
      args.push(...session.args);
    }
    return args;
  }

  if (isCodex) {
    if (codexBridgeReady) {
      args.push('--enable', 'codex_hooks');
    }
    if (session.initialPrompt) {
      args.push(session.initialPrompt);
    }
    return args;
  }

  if (session.worktree !== undefined) {
    args.push('--worktree');
    if (session.worktree) {
      args.push(session.worktree);
    }
  }
  if (session.permissionMode) {
    args.push('--permission-mode', session.permissionMode);
  }
  if (session.effort) {
    args.push('--effort', session.effort);
  }
  if (session.enableAutoMode) {
    args.push('--enable-auto-mode');
  }
  if (session.allowBypassPermissions) {
    args.push('--allow-dangerously-skip-permissions');
  }
  if (session.initialPrompt) {
    args.push(session.initialPrompt);
  }

  return args;
}

export function resolveCreateHookMode(input: {
  isClaude: boolean;
  isCodex: boolean;
  codexBridgeReady: boolean;
  hookRuntimeState: string;
}): 'live' | 'fallback' {
  const { isClaude, isCodex, codexBridgeReady, hookRuntimeState } = input;
  return (isClaude || (isCodex && codexBridgeReady)) && hookRuntimeState === 'ready'
    ? 'live'
    : 'fallback';
}
