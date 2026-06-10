import type { SessionInfo } from '@shared/types';

type ContextUsageSession = Pick<
  SessionInfo,
  'sessionType' | 'claudeSessionId' | 'codexThreadId'
>;

export function getContextUsageAgentSessionId(
  session: ContextUsageSession | null | undefined,
): string | null {
  if (!session) return null;

  switch (session.sessionType) {
    case 'claude':
      return session.claudeSessionId;
    case 'codex':
      return session.codexThreadId;
    default:
      return null;
  }
}
