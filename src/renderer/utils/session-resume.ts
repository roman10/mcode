import { getAgentDefinition } from '@shared/session-agents';
import type { SessionCreateInput, SessionInfo } from '@shared/types';

export function getResumeIdentity(session: SessionInfo | undefined): string | null {
  if (!session) return null;

  switch (getAgentDefinition(session.sessionType)?.resumeIdentityKind) {
    case 'claudeSessionId':
      return session.claudeSessionId;
    case 'codexThreadId':
      return session.codexThreadId;
    case 'geminiSessionId':
      return session.geminiSessionId;
    case 'copilotSessionId':
      return session.copilotSessionId;
    default:
      return null;
  }
}

export function canResumeSession(session: SessionInfo | undefined): boolean {
  return !!getResumeIdentity(session);
}

export function getResumeUnavailableMessage(session: SessionInfo | undefined): string | null {
  if (!session || canResumeSession(session)) return null;

  switch (getAgentDefinition(session.sessionType)?.resumeIdentityKind) {
    case 'claudeSessionId':
      return 'No Claude session ID recorded — cannot resume';
    case 'codexThreadId':
      return 'No Codex thread ID recorded — cannot resume';
    case 'geminiSessionId':
      return 'No Gemini session ID recorded — cannot resume';
    case 'copilotSessionId':
      return 'No Copilot session ID recorded — cannot resume';
    default:
      return null;
  }
}

export function canOverrideResumeAccount(session: SessionInfo | undefined): boolean {
  return !!session && (getAgentDefinition(session.sessionType)?.supportsAccountProfiles ?? false);
}

export function buildStartNewSessionInput(
  session: SessionInfo,
  accountOverride?: string,
): SessionCreateInput {
  const dialogMode = getAgentDefinition(session.sessionType)?.dialogMode ?? 'minimal';
  if (dialogMode === 'minimal') {
    return {
      cwd: session.cwd,
      sessionType: session.sessionType,
    };
  }

  return {
    cwd: session.cwd,
    permissionMode: session.permissionMode,
    sessionType: session.sessionType,
    accountId: accountOverride,
  };
}
