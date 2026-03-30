import { CLAUDE_ICON, CODEX_ICON, COPILOT_ICON, GEMINI_ICON } from './constants';
import type { SessionType } from './types';

export type AgentSessionType = 'claude' | 'codex' | 'gemini' | 'copilot';
export type AgentDialogMode = 'full' | 'minimal';
export type AgentResumeIdentityKind = 'claudeSessionId' | 'codexThreadId' | 'geminiSessionId' | 'copilotSessionId' | null;

export interface AgentDefinition {
  sessionType: AgentSessionType;
  displayName: string;
  icon: string;
  defaultCommand: string;
  supportsTaskQueue: boolean;
  supportsPlanMode: boolean;
  hidesTerminalCursor: boolean;
  dialogMode: AgentDialogMode;
  supportsAccountProfiles: boolean;
  supportsModelDisplay: boolean;
  supportsTokenTracking: boolean;
  supportsCostEstimation: boolean;
  supportsInputTracking: boolean;
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
    supportsPlanMode: true,
    hidesTerminalCursor: true,
    dialogMode: 'full',
    supportsAccountProfiles: true,
    supportsModelDisplay: true,
    supportsTokenTracking: true,
    supportsCostEstimation: true,
    supportsInputTracking: true,
    installHelpUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    resumeIdentityKind: 'claudeSessionId',
  },
  codex: {
    sessionType: 'codex',
    displayName: 'Codex CLI',
    icon: CODEX_ICON,
    defaultCommand: 'codex',
    supportsTaskQueue: false,
    supportsPlanMode: false,
    hidesTerminalCursor: true,
    dialogMode: 'minimal',
    supportsAccountProfiles: false,
    supportsModelDisplay: false,
    supportsTokenTracking: false,
    supportsCostEstimation: false,
    supportsInputTracking: false,
    resumeIdentityKind: 'codexThreadId',
  },
  gemini: {
    sessionType: 'gemini',
    displayName: 'Gemini CLI',
    icon: GEMINI_ICON,
    defaultCommand: 'gemini',
    supportsTaskQueue: true,
    supportsPlanMode: false,
    hidesTerminalCursor: true,
    dialogMode: 'minimal',
    supportsAccountProfiles: false,
    supportsModelDisplay: true,
    supportsTokenTracking: false,
    supportsCostEstimation: false,
    supportsInputTracking: false,
    resumeIdentityKind: 'geminiSessionId',
  },
  copilot: {
    sessionType: 'copilot',
    displayName: 'Copilot CLI',
    icon: COPILOT_ICON,
    defaultCommand: 'copilot',
    supportsTaskQueue: true,
    supportsPlanMode: false,
    hidesTerminalCursor: true,
    dialogMode: 'minimal',
    supportsAccountProfiles: false,
    supportsModelDisplay: true,
    supportsTokenTracking: true,
    supportsCostEstimation: false,
    supportsInputTracking: true,
    installHelpUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started',
    resumeIdentityKind: 'copilotSessionId',
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
