import { randomUUID } from 'node:crypto';
import type { AccountProfile, AuthStatusResult } from '../../shared/types';
import type { AccountProviderRegistry } from './account-provider';
import type { AccountProfileRepository } from './account-profile-repository';
import type { AccountHomeManager } from './account-home-manager';
import type { AccountIdentityRepository } from './account-identity-repository';

/**
 * Orchestration layer for account operations.
 * Delegates to repository (DB), home manager (filesystem), identity repo, and provider registry (adapters).
 */
export class AccountService {
  constructor(
    private repo: AccountProfileRepository,
    private homeManager: AccountHomeManager,
    private registry: AccountProviderRegistry,
    private identityRepo: AccountIdentityRepository,
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
   * Removes identity rows, the DB record, and the home directory.
   */
  delete(accountId: string): void {
    this.identityRepo.deleteAll(accountId);
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
    const env: Record<string, string> = {};
    for (const a of this.registry.getRegistered()) {
      Object.assign(env, a.getConfigEnv(account.homeDir));
    }
    return env;
  }

  // --- Auth operations (delegate to provider adapter) ---

  /**
   * Check auth status for an account by delegating to the appropriate provider adapter.
   * Writes result to both the provider identity table and (for Claude) the legacy email column.
   */
  async getAuthStatus(accountId: string, sessionType?: string): Promise<AuthStatusResult> {
    const account = this.get(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);

    const type = sessionType ?? 'claude';
    const adapter = this.registry.get(type);
    if (!adapter) throw new Error(`No provider adapter for: ${type}`);

    const result = await adapter.checkAuthStatus(account);

    // Write to provider identity table
    this.identityRepo.upsert(accountId, type, result.status, result.identity, result.displayName);

    // Backward compat: still write email for Claude so renderer can read account_profiles.email
    if (type === 'claude' && result.email) {
      this.repo.setEmail(accountId, result.email);
    }

    return result;
  }

  /**
   * Quick check whether the CLI is installed and the default account is authenticated.
   * Used at startup for the sidebar banner.
   */
  async checkCliInstalled(sessionType?: string): Promise<AuthStatusResult> {
    const type = sessionType ?? 'claude';
    const adapter = this.registry.get(type);
    if (!adapter) return { status: 'cli-not-found' };

    const cliStatus = await adapter.checkCliInstalled();
    if (cliStatus !== 'ok') return { status: cliStatus };

    const defaultAcc = this.getDefault();
    if (!defaultAcc) return { status: 'not-authenticated' };
    return this.getAuthStatus(defaultAcc.accountId, type);
  }
}
