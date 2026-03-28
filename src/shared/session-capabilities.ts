import { getAgentDefinition } from './session-agents';
import type { SessionInfo, SessionType } from './types';

type TaskSessionLike = Pick<SessionInfo, 'sessionType' | 'hookMode' | 'status'> | undefined;
type ModelSessionLike = Pick<SessionInfo, 'sessionType' | 'model'> | undefined;

function hasLiveTaskQueue(session: TaskSessionLike): boolean {
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
  return hasLiveTaskQueue(session) && (session.status === 'active' || session.status === 'idle');
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