import type { SessionInfo } from '@shared/types';

export function canResumeSession(session: SessionInfo | undefined): boolean {
  if (!session) return false;

  if (session.sessionType === 'claude') {
    return !!session.claudeSessionId;
  }

  if (session.sessionType === 'codex') {
    return !!session.codexThreadId;
  }

  return false;
}
