import { randomUUID } from 'node:crypto';
import type { AccountProfile, AuthStatusResult } from '../../shared/types';
import type { AccountProviderRegistry } from './account-provider';
import type { AccountProfileRepository } from './account-profile-repository';
import type { AccountHomeManager } from './account-home-manager';

/**
 * Orchestration layer for account operations.
 * Delegates to repository (DB), home manager (filesystem), and provider registry (adapters).
 */
export class AccountService {
  constructor(
    private repo: AccountProfileRepository,
    private homeManager: AccountHomeManager,
    private registry: AccountProviderRegistry,
  ) {}

  // --- Profile operations (delegate to repository) ---

  ensureDefaultAccount(): void {
    this.repo.ensureDefaultAccount();
  }

  list(): AccountProfile[] {
    return this.repo.list();
  }

  get(accountId: string): AccountProfile | null {
    return this.repo.get(accountId);
  }

  getDefault(): AccountProfile | null {
    return this.repo.getDefault();
  }

  touchLastUsed(accountId: string): void {
    this.repo.touchLastUsed(accountId);
  }

  setEmail(accountId: string, email: string): void {
    this.repo.setEmail(accountId, email);
  }

  // --- Account lifecycle (orchestrate repository + home manager) ---

  /**
   * Create a secondary account profile.
   * Sets up the isolated home directory and inserts the DB record.
   */
  create(name?: string): AccountProfile {
    const accountId = randomUUID();
    const accountHome = this.homeManager.computeHomeDir(accountId);

    this.homeManager.setupAccountDirectory(accountHome);

    return this.repo.insertWithId(accountId, name?.trim() || '', accountHome);
  }

  rename(accountId: string, name: string): void {
    this.repo.rename(accountId, name);
  }

  /**
   * Delete a secondary account profile.
   * Removes the DB record and cleans up the home directory.
   */
  delete(accountId: string): void {
    const homeDir = this.repo.delete(accountId);
    if (homeDir) {
      this.homeManager.removeAccountHome(homeDir);
    }
  }

  // --- Symlink and settings operations ---

  syncSymlinks(accountId: string): void {
    const account = this.get(accountId);
    if (!account) return;
    this.homeManager.syncSymlinks(account);
  }

  /**
   * Get all Claude settings.json paths that need hook reconciliation.
   * Returns the primary path plus all secondary account paths.
   */
  getAllSettingsPaths(): string[] {
    return this.homeManager.getAllSettingsPaths(this.list());
  }

  // --- Provider-aware session environment ---

  /**
   * Get the environment variables to set for a session using this account.
   * Returns empty object for the default account (no override needed).
   *
   * When sessionType matches a registered adapter, uses that adapter's config env.
   * When no adapter is found (e.g. terminal sessions), merges env from all
   * registered adapters so auth terminals get the correct environment.
   */
  getSessionEnv(accountId: string | undefined, sessionType?: string): Record<string, string> {
    if (!accountId) return {};

    const account = this.get(accountId);
    if (!account || account.isDefault || !account.homeDir) return {};

    // Re-sync symlinks before spawning
    this.homeManager.syncSymlinks(account);

    const adapter = sessionType ? this.registry.get(sessionType) : undefined;
    if (adapter) {
      return adapter.getConfigEnv(account.homeDir);
    }

    // No specific adapter (terminal sessions, undefined type):
    // merge env from all registered adapters so auth terminals get correct env.
    // Phase 1: only Claude registered → produces { HOME, CLAUDE_CONFIG_DIR } = identical to today.
    const env: Record<string, string> = {};
    for (const a of this.registry.getRegistered()) {
      Object.assign(env, a.getConfigEnv(account.homeDir));
    }
    return env;
  }

  // --- Auth operations (delegate to provider adapter) ---

  /**
   * Check auth status for an account by delegating to the Claude provider adapter.
   * Currently only supports Claude (the only provider with supportsAccountProfiles).
   */
  async getAuthStatus(accountId: string): Promise<AuthStatusResult> {
    const account = this.get(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);

    // Use the Claude adapter since it's the only one supporting account profiles in Phase 1.
    // In Phase 3+, this will be parameterized by provider type.
    const adapter = this.registry.get('claude');
    if (!adapter) throw new Error('No Claude provider adapter registered');

    return adapter.checkAuthStatus(account);
  }

  /**
   * Quick check whether the CLI is installed and the default account is authenticated.
   * Used at startup for the sidebar banner.
   */
  async checkCliInstalled(): Promise<AuthStatusResult> {
    const defaultAcc = this.getDefault();
    if (!defaultAcc) return { status: 'not-authenticated' };
    return this.getAuthStatus(defaultAcc.accountId);
  }
}
