import { CLAUDE_ICON, CODEX_ICON, GEMINI_ICON } from './constants';
import type { SessionType } from './types';

export type AgentSessionType = 'claude' | 'codex' | 'gemini';
export type AgentDialogMode = 'full' | 'minimal';
export type AgentResumeIdentityKind = 'claudeSessionId' | 'codexThreadId' | 'geminiSessionId' | null;

export interface AgentDefinition {
  sessionType: AgentSessionType;
  displayName: string;
  icon: string;
  defaultCommand: string;
  supportsTaskQueue: boolean;
  hidesTerminalCursor: boolean;
  dialogMode: AgentDialogMode;
  supportsAccountProfiles: boolean;
  supportsModelDisplay: boolean;
  installHelpUrl?: string;
  resumeIdentityKind: AgentResumeIdentityKind;
}

const AGENT_DEFINITIONS: Record<AgentSessionType, AgentDefinition> = {
  claude: {
    sessionType: 'claude',
    displayName: 'Claude Code',
    icon: CLAUDE_ICON,
    defaultCommand: 'claude',
    supportsTaskQueue: true,
    hidesTerminalCursor: true,
    dialogMode: 'full',
    supportsAccountProfiles: true,
    supportsModelDisplay: true,
    installHelpUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    resumeIdentityKind: 'claudeSessionId',
  },
  codex: {
    sessionType: 'codex',
    displayName: 'Codex CLI',
    icon: CODEX_ICON,
    defaultCommand: 'codex',
    supportsTaskQueue: false,
    hidesTerminalCursor: true,
    dialogMode: 'minimal',
    supportsAccountProfiles: false,
    supportsModelDisplay: false,
    resumeIdentityKind: 'codexThreadId',
  },
  gemini: {
    sessionType: 'gemini',
    displayName: 'Gemini CLI',
    icon: GEMINI_ICON,
    defaultCommand: 'gemini',
    supportsTaskQueue: false,
    hidesTerminalCursor: true,
    dialogMode: 'minimal',
    supportsAccountProfiles: false,
    supportsModelDisplay: false,
    resumeIdentityKind: 'geminiSessionId',
  },
};

export const AGENT_SESSION_TYPES = Object.freeze(Object.keys(AGENT_DEFINITIONS) as AgentSessionType[]);

export function isAgentSessionType(sessionType: string | SessionType | undefined): sessionType is AgentSessionType {
  return !!sessionType && Object.hasOwn(AGENT_DEFINITIONS, sessionType);
}

export function isAgentSession(sessionType: string | SessionType | undefined): boolean {
  return isAgentSessionType(sessionType);
}

export function getAgentDefinition(sessionType: string | SessionType | undefined): AgentDefinition | null {
  return isAgentSessionType(sessionType) ? AGENT_DEFINITIONS[sessionType] : null;
}

export function shouldHideTerminalCursor(sessionType: string | SessionType | undefined): boolean {
  return getAgentDefinition(sessionType)?.hidesTerminalCursor ?? false;
}
