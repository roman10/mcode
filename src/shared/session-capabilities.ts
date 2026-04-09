import { getAgentDefinition, type SlashCommandSupport } from './session-agents';
import type { SessionInfo, SessionType } from './types';

type TaskSessionLike = Pick<SessionInfo, 'sessionType' | 'hookMode' | 'status'> | null | undefined;
type ModelSessionLike = Pick<SessionInfo, 'sessionType' | 'model'> | null | undefined;

export function hasLiveTaskQueue(session: TaskSessionLike): session is NonNullable<TaskSessionLike> {
  return !!session
    && (getAgentDefinition(session.sessionType)?.supportsTaskQueue ?? false)
    && session.hookMode === 'live';
}

export function canSessionQueueTasks(session: TaskSessionLike): boolean {
  return hasLiveTaskQueue(session) && session.status !== 'ended';
}

export function canSessionBeDefaultTaskTarget(session: TaskSessionLike): boolean {
  return canSessionBeTaskTarget(session);
}

export function canSessionBeTaskTarget(session: TaskSessionLike): boolean {
  return hasLiveTaskQueue(session) && session.status !== 'ended' && session.status !== 'detached';
}

export function canSessionBePlanResponseTarget(session: TaskSessionLike): boolean {
  return hasLiveTaskQueue(session)
    && (getAgentDefinition(session.sessionType)?.supportsPlanMode ?? false)
    && (session.status === 'active' || session.status === 'idle' || session.status === 'waiting');
}

export function canDisplaySessionModel(session: ModelSessionLike): boolean {
  return !!session?.model && (getAgentDefinition(session.sessionType)?.supportsModelDisplay ?? false);
}

export function getSessionInstallHelp(
  sessionType: SessionType | string | undefined,
): { command: string; displayName: string; url: string } | null {
  const agent = getAgentDefinition(sessionType);
  if (!agent?.installHelpUrl) return null;
  return {
    command: agent.defaultCommand,
    displayName: agent.displayName,
    url: agent.installHelpUrl,
  };
}

export function supportsSessionSlashCommands(sessionType: SessionType | string | undefined): boolean {
  return !!getAgentDefinition(sessionType)?.slashCommands;
}

export function getSessionSlashCommandSupport(
  sessionType: SessionType | string | undefined,
): SlashCommandSupport | null {
  return getAgentDefinition(sessionType)?.slashCommands ?? null;
}

export function getSessionSlashCommandHelp(
  sessionType: SessionType | string | undefined,
): { command: string; displayName: string; supportsCustomCommands: boolean } | null {
  const agent = getAgentDefinition(sessionType);
  const slashCommands = agent?.slashCommands;
  if (!agent || !slashCommands) return null;
  return {
    command: slashCommands.helpCommand,
    displayName: agent.displayName,
    supportsCustomCommands: !!(slashCommands.userCommandFiles || slashCommands.projectCommandFiles),
  };
}
