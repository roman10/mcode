import type { AgentSessionType } from '../../shared/session-agents';
import type { AccountProfile, AuthStatusResult, CliAuthStatus, SessionCreateInput, SubscriptionUsage } from '../../shared/types';

/**
 * Provider-specific account adapter.
 * Each CLI agent (Claude, Copilot, Gemini, Codex) implements this interface
 * to declare its auth, config isolation, and subscription semantics.
 */
export interface AccountProviderAdapter {
  readonly sessionType: AgentSessionType;
  readonly supportsAccountProfiles: boolean;

  /** Config dir name relative to home (e.g., '.claude', '.copilot'). */
  getConfigDirName(): string;

  /**
   * Return env vars to isolate this provider under an account home.
   * Each provider has different semantics:
   * - Claude: { HOME, CLAUDE_CONFIG_DIR }
   * - Copilot: { COPILOT_HOME } (HOME override breaks macOS Keychain)
   * - Gemini: { GEMINI_CLI_HOME, GEMINI_FORCE_FILE_STORAGE }
   * - Codex: { CODEX_HOME }
   */
  getConfigEnv(accountHome: string): Record<string, string>;

  /** Subdirs inside the config dir that are safe to symlink from the primary account. */
  getSharedConfigSubdirs(): readonly string[];

  /**
   * Return the settings file name (relative to the config dir) that needs to be copied
   * to new account homes and included in hook reconciliation paths.
   * Return null if this provider does not use a settings file for hook config.
   * Example: Claude returns 'settings.json'; Copilot (uses hooks.json via its own bridge) returns null.
   */
  getSettingsFileName(): string | null;

  /** Check if the CLI binary is installed and available. */
  checkCliInstalled(): Promise<CliAuthStatus>;

  /** Check auth status for a specific account. */
  checkAuthStatus(account: AccountProfile): Promise<AuthStatusResult>;

  /**
   * Build the terminal session input for authenticating this provider.
   * Returns null if the provider does not support terminal-based auth.
   */
  buildAuthTerminalInput(account: AccountProfile): SessionCreateInput | null;

  /** URL to show when the CLI is not installed. */
  getInstallHelpUrl(): string | undefined;

  /** Whether this provider supports subscription/quota display. */
  supportsSubscriptionUsage(): boolean;

  /** Fetch subscription/usage data. Only called if supportsSubscriptionUsage() is true. */
  getSubscriptionUsage(account: AccountProfile, force?: boolean): Promise<SubscriptionUsage | null>;
}

/**
 * Registry of provider adapters keyed by session type.
 * The rest of the account system queries this registry instead of
 * hardcoding provider-specific logic.
 */
export class AccountProviderRegistry {
  private adapters = new Map<AgentSessionType, AccountProviderAdapter>();

  register(adapter: AccountProviderAdapter): void {
    this.adapters.set(adapter.sessionType, adapter);
  }

  get(sessionType: string): AccountProviderAdapter | undefined {
    return this.adapters.get(sessionType as AgentSessionType);
  }

  /** All config dir names that must be isolated (not symlinked) in account homes. */
  getAllConfigDirNames(): Set<string> {
    const names = new Set<string>();
    for (const adapter of this.adapters.values()) {
      names.add(adapter.getConfigDirName());
    }
    return names;
  }

  /** All registered adapters. */
  getRegistered(): AccountProviderAdapter[] {
    return [...this.adapters.values()];
  }
}
