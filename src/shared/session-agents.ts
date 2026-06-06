import { AGY_ICON, CLAUDE_ICON, CODEX_ICON, COPILOT_ICON } from './constants';
import type { SessionType } from './types';

// 'gemini' is retained as a known session type for historical rows and analytics
// (token/quota/account providers), but Gemini is no longer a launchable agent —
// it has no AGENT_DEFINITIONS entry (see below).
export type AgentSessionType = 'claude' | 'codex' | 'gemini' | 'copilot' | 'agy';
export type AgentDialogMode = 'full' | 'minimal';
export type AgentResumeIdentityKind = 'claudeSessionId' | 'codexThreadId' | 'copilotSessionId' | null;
export type SlashCommandPathStyle = 'basename' | 'colon';
export type SlashCommandDescriptionFormat = 'markdown-first-line' | 'toml-description';

export interface SlashCommandFileSource {
  dirSegments: readonly string[];
  extension: '.md' | '.toml';
  recursive?: boolean;
  pathStyle?: SlashCommandPathStyle;
  descriptionFormat?: SlashCommandDescriptionFormat;
}

export interface SlashCommandSupport {
  builtins: ReadonlyMap<string, string>;
  helpCommand: string;
  userCommandFiles?: SlashCommandFileSource;
  projectCommandFiles?: SlashCommandFileSource;
}

export interface AgentDefinition {
  sessionType: AgentSessionType;
  displayName: string;
  icon: string;
  defaultCommand: string;
  supportsTaskQueue: boolean;
  supportsPlanMode: boolean;
  /**
   * true = derive the session's auto-label from the first UserPromptSubmit hook
   * event (label-static agents that don't drive a meaningful terminal title).
   * false = the CLI self-titles via OSC terminal-title escape sequences (Claude),
   * so the OSC path owns auto-labeling and the hook path stays out of the way.
   */
  autoLabelFromFirstPrompt: boolean;
  /** true = CLI manages cursor via DECTCEM sequences; xterm cursor hidden initially. */
  hidesTerminalCursor: boolean;
  dialogMode: AgentDialogMode;
  supportsAccountProfiles: boolean;
  supportsModelDisplay: boolean;
  supportsTokenTracking: boolean;
  supportsCostEstimation: boolean;
  supportsInputTracking: boolean;
  installHelpUrl?: string;
  resumeIdentityKind: AgentResumeIdentityKind;
  slashCommands?: SlashCommandSupport;
}

const CLAUDE_SLASH_COMMANDS: SlashCommandSupport = {
  helpCommand: '/help',
  builtins: new Map([
    ['compact', 'Compact conversation history to reduce context'],
    ['clear', 'Clear conversation and start fresh'],
    ['help', 'Show available commands and help'],
    ['init', 'Initialize Claude Code project settings'],
    ['cost', 'Show token usage and cost for this session'],
    ['doctor', 'Check Claude Code installation health'],
    ['login', 'Log in to your Anthropic account'],
    ['logout', 'Log out of your Anthropic account'],
    ['bug', 'Report a bug to Anthropic'],
    ['review', 'Review a pull request'],
    ['memory', 'Edit CLAUDE.md memory files'],
    ['model', 'Switch the AI model'],
    ['config', 'Edit Claude Code configuration'],
    ['vim', 'Toggle vim mode for the input'],
    ['terminal-setup', 'Set up terminal integration'],
    ['permissions', 'Manage tool permissions'],
  ]),
  userCommandFiles: {
    dirSegments: ['.claude', 'commands'],
    extension: '.md',
    descriptionFormat: 'markdown-first-line',
  },
  projectCommandFiles: {
    dirSegments: ['.claude', 'commands'],
    extension: '.md',
    descriptionFormat: 'markdown-first-line',
  },
};

const CODEX_SLASH_COMMANDS: SlashCommandSupport = {
  helpCommand: '/help',
  builtins: new Map([
    ['permissions', 'Set what Codex can do without asking first'],
    ['sandbox-add-read-dir', 'Grant sandbox read access to another directory'],
    ['agent', 'Switch the active agent thread'],
    ['apps', 'Browse apps and insert them into your prompt'],
    ['clear', 'Clear the terminal and start a new chat'],
    ['compact', 'Summarize the visible conversation'],
    ['copy', 'Copy the latest completed Codex output'],
    ['diff', 'Show the current Git diff'],
    ['exit', 'Exit the CLI'],
    ['quit', 'Exit the CLI'],
    ['experimental', 'Toggle experimental features'],
    ['feedback', 'Send logs to Codex maintainers'],
    ['init', 'Generate an AGENTS.md scaffold'],
    ['logout', 'Sign out of Codex'],
    ['mcp', 'List configured MCP tools'],
    ['mention', 'Attach a file to the conversation'],
    ['model', 'Choose the active model'],
    ['fast', 'Toggle Fast mode'],
    ['plan', 'Switch to plan mode'],
    ['personality', 'Choose a communication style'],
    ['ps', 'Show background terminals and output'],
    ['fork', 'Fork the current conversation'],
    ['resume', 'Resume a saved conversation'],
    ['new', 'Start a new conversation in the same session'],
    ['review', 'Review your working tree or selected changes'],
    ['status', 'Display session configuration and token usage'],
    ['debug-config', 'Print config layer diagnostics'],
    ['statusline', 'Configure footer status-line fields'],
  ]),
};

const COPILOT_SLASH_COMMANDS: SlashCommandSupport = {
  helpCommand: '/help',
  builtins: new Map([
    ['add-dir', 'Add a directory to the allowed list for file access'],
    ['agent', 'Browse and select available agents'],
    ['allow-all', 'Enable all permissions'],
    ['yolo', 'Alias for enabling all permissions'],
    ['clear', 'Clear the conversation history'],
    ['new', 'Clear the conversation history'],
    ['compact', 'Summarize conversation history to reduce context usage'],
    ['context', 'Show context window token usage'],
    ['cwd', 'Show or change the current working directory'],
    ['cd', 'Show or change the current working directory'],
    ['delegate', 'Delegate work to a remote repository with an AI-generated PR'],
    ['diff', 'Review the changes in the current directory'],
    ['exit', 'Exit the CLI'],
    ['quit', 'Exit the CLI'],
    ['experimental', 'Toggle experimental features'],
    ['feedback', 'Provide feedback about the CLI'],
    ['fleet', 'Run parts of a task in parallel with subagents'],
    ['help', 'Show help for interactive commands'],
    ['ide', 'Connect to an IDE workspace'],
    ['init', 'Initialize Copilot custom instructions for this repository'],
    ['list-dirs', 'Display directories allowed for file access'],
    ['login', 'Log in to Copilot'],
    ['logout', 'Log out of Copilot'],
    ['lsp', 'Manage language server configuration'],
    ['mcp', 'Manage MCP server configuration'],
    ['model', 'Select the AI model'],
    ['models', 'Alias for /model'],
    ['plan', 'Create an implementation plan before coding'],
    ['plugin', 'Manage plugins and plugin marketplaces'],
    ['rename', 'Rename the current session'],
    ['reset-allowed-tools', 'Reset the list of allowed tools'],
    ['resume', 'Switch to a different session'],
    ['review', 'Run the code review agent'],
    ['session', 'Show session information and workspace summary'],
    ['share', 'Share the session to a file or gist'],
    ['skills', 'Manage skills for enhanced capabilities'],
    ['terminal-setup', 'Configure the terminal for multiline input'],
    ['theme', 'View or configure the terminal theme'],
    ['usage', 'Display session usage metrics'],
    ['user', 'Manage the current GitHub user'],
  ]),
};

// Antigravity CLI (agy) v1.0.1 has no in-TUI slash-command listing we can rely on
// yet; this minimal map covers the known `/model` switch. Expand once the live
// `/help` output is captured. TODO(agy live): populate from the TUI `/help`.
const AGY_SLASH_COMMANDS: SlashCommandSupport = {
  helpCommand: '/help',
  builtins: new Map([
    ['model', 'Switch the AI model'],
    ['help', 'Show available commands'],
  ]),
};

// Partial: 'gemini' is intentionally absent — it is a retired (non-launchable)
// agent kept only for historical/analytics purposes. getAgentDefinition('gemini')
// returns null, which disables launch/resume/slash-commands for those rows.
const AGENT_DEFINITIONS: Partial<Record<AgentSessionType, AgentDefinition>> = {
  claude: {
    sessionType: 'claude',
    displayName: 'Claude Code',
    icon: CLAUDE_ICON,
    defaultCommand: 'claude',
    supportsTaskQueue: true,
    supportsPlanMode: true,
    autoLabelFromFirstPrompt: false, // Claude self-titles via OSC terminal title
    hidesTerminalCursor: true,
    dialogMode: 'full',
    supportsAccountProfiles: true,
    supportsModelDisplay: true,
    supportsTokenTracking: true,
    supportsCostEstimation: true,
    supportsInputTracking: true,
    installHelpUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    resumeIdentityKind: 'claudeSessionId',
    slashCommands: CLAUDE_SLASH_COMMANDS,
  },
  codex: {
    sessionType: 'codex',
    displayName: 'Codex CLI',
    icon: CODEX_ICON,
    defaultCommand: 'codex',
    supportsTaskQueue: true,
    // Codex "plan mode" is a conversational collaboration mode entered via the
    // in-TUI `/plan` slash command — it does NOT emit Claude's ExitPlanMode
    // numbered-approval menu. mcode's plan-mode feature (the planResponse task
    // queue: auto-accept/manual-approve/revise via `❯ N.` menu navigation) only
    // drives that menu, and codex cannot be launched into plan mode (no flag;
    // `default_mode` is not a recognized config field as of codex 0.136.0).
    // Keep false: flipping it would wire UI that has no menu to drive.
    supportsPlanMode: false,
    autoLabelFromFirstPrompt: true, // no OSC title; UserPromptSubmit carries `prompt`
    hidesTerminalCursor: true,
    dialogMode: 'minimal',
    supportsAccountProfiles: true,
    supportsModelDisplay: true,
    supportsTokenTracking: true,
    supportsCostEstimation: true,
    supportsInputTracking: true,
    resumeIdentityKind: 'codexThreadId',
    slashCommands: CODEX_SLASH_COMMANDS,
  },
  copilot: {
    sessionType: 'copilot',
    displayName: 'Copilot CLI',
    icon: COPILOT_ICON,
    defaultCommand: 'copilot',
    supportsTaskQueue: true,
    supportsPlanMode: false,
    autoLabelFromFirstPrompt: true, // no OSC title; first-prompt hook drives the label
    hidesTerminalCursor: false, // Copilot CLI does not send DECTCEM \e[?25h
    dialogMode: 'minimal',
    supportsAccountProfiles: true,
    supportsModelDisplay: true,
    supportsTokenTracking: true,
    supportsCostEstimation: false,
    supportsInputTracking: true,
    installHelpUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started',
    resumeIdentityKind: 'copilotSessionId',
    slashCommands: COPILOT_SLASH_COMMANDS,
  },
  agy: {
    sessionType: 'agy',
    displayName: 'Antigravity CLI',
    icon: AGY_ICON,
    defaultCommand: 'agy',
    supportsTaskQueue: true,
    supportsPlanMode: false, // no plan flag in v1.0.1
    autoLabelFromFirstPrompt: true, // no OSC title; harmless even without hooks (agy emits none)
    hidesTerminalCursor: true, // verified live: agy enters the alt screen and emits DECTCEM hide (\e[?25l)
    dialogMode: 'minimal',
    supportsAccountProfiles: false, // no agy account provider; agy auth is keyring/GUI-shared, so HOME-swap can't isolate it
    supportsModelDisplay: false, // no --model flag; model is chosen only via in-TUI /model
    supportsTokenTracking: false, // no hooks / no parseable token store
    supportsCostEstimation: false,
    supportsInputTracking: false,
    installHelpUrl: 'https://antigravity.google/docs/cli-using',
    resumeIdentityKind: null, // launch-only v1; resume deferred (see plan)
    slashCommands: AGY_SLASH_COMMANDS,
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
  return (isAgentSessionType(sessionType) ? AGENT_DEFINITIONS[sessionType] : null) ?? null;
}

export function shouldHideTerminalCursor(sessionType: string | SessionType | undefined): boolean {
  return getAgentDefinition(sessionType)?.hidesTerminalCursor ?? false;
}
