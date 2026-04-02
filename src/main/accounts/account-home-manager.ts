import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, symlinkSync, copyFileSync, rmSync } from 'node:fs';
import { logger } from '../logger';
import type { AccountProviderRegistry } from './account-provider';
import type { AccountProfile } from '../../shared/types';

const ACCOUNTS_BASE = join(homedir(), '.mcode', 'accounts');

/**
 * Manages isolated home directories for secondary account profiles.
 * Uses the provider registry to determine which config directories
 * must be isolated (not symlinked) in account homes.
 */
export class AccountHomeManager {
  constructor(private registry: AccountProviderRegistry) {}

  /** Compute the home directory path for a new account. */
  computeHomeDir(accountId: string): string {
    return join(ACCOUNTS_BASE, accountId);
  }

  /**
   * Create an account home directory with symlinks mirroring the real home.
   * Provider config directories are isolated (created as real dirs, not symlinks).
   * Shared subdirs inside each provider's config dir are symlinked from the primary.
   */
  setupAccountDirectory(accountHome: string): void {
    const realHome = homedir();
    const denylist = this.registry.getAllConfigDirNames();

    // Create account home and isolated config directories for all registered providers
    for (const dirName of denylist) {
      mkdirSync(join(accountHome, dirName), { recursive: true });
    }

    // Symlink everything from real HOME except provider config dirs
    const entries = readdirSync(realHome, { withFileTypes: true });
    for (const entry of entries) {
      if (denylist.has(entry.name)) continue;

      const sourcePath = join(realHome, entry.name);
      const targetPath = join(accountHome, entry.name);

      if (existsSync(targetPath)) continue;

      try {
        symlinkSync(sourcePath, targetPath);
      } catch {
        logger.warn('accounts', 'Failed to symlink', { source: sourcePath, target: targetPath });
      }
    }

    // Copy each provider's settings file so hooks work in the new account
    for (const adapter of this.registry.getRegistered()) {
      const fileName = adapter.getSettingsFileName();
      if (!fileName) continue;
      const src = join(realHome, adapter.getConfigDirName(), fileName);
      if (existsSync(src)) {
        copyFileSync(src, join(accountHome, adapter.getConfigDirName(), fileName));
      }
    }

    // Symlink shared subdirectories for each provider
    this.syncProviderSubdirSymlinks(accountHome);

    logger.info('accounts', 'Set up account directory', { accountHome });
  }

  /**
   * Re-sync symlinks in an account's home directory.
   * Creates missing symlinks for new HOME entries (skipping provider config dirs).
   * Also syncs shared provider subdirectories.
   */
  syncSymlinks(account: AccountProfile): void {
    if (account.isDefault || !account.homeDir) return;

    const accountHome = account.homeDir;

    if (!existsSync(accountHome)) {
      this.setupAccountDirectory(accountHome);
      return;
    }

    const realHome = homedir();
    const denylist = this.registry.getAllConfigDirNames();

    const realEntries = readdirSync(realHome, { withFileTypes: true });
    for (const entry of realEntries) {
      if (denylist.has(entry.name)) continue;

      const targetPath = join(accountHome, entry.name);
      if (existsSync(targetPath)) continue;

      const sourcePath = join(realHome, entry.name);
      try {
        symlinkSync(sourcePath, targetPath);
      } catch {
        // Skip entries that can't be symlinked
      }
    }

    this.syncProviderSubdirSymlinks(accountHome);
  }

  /**
   * Remove an account's home directory.
   * Safety: only deletes if the path is inside the expected base directory.
   */
  removeAccountHome(homeDir: string): void {
    const resolvedHome = resolve(homeDir);
    if (!resolvedHome.startsWith(ACCOUNTS_BASE + '/') || !existsSync(resolvedHome)) return;

    try {
      rmSync(resolvedHome, { recursive: true });
      logger.info('accounts', 'Removed account home directory', { homeDir: resolvedHome });
    } catch (err) {
      logger.warn('accounts', 'Failed to remove account home directory', {
        homeDir: resolvedHome,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Get all settings.json paths that need hook reconciliation, across all registered
   * providers that declare a settings file. Returns the primary paths (one per provider)
   * followed by the corresponding paths for each secondary account home.
   */
  getAllSettingsPaths(accounts: AccountProfile[]): string[] {
    const realHome = homedir();
    const adaptersWithSettings = this.registry.getRegistered().filter((a) => a.getSettingsFileName());
    const paths: string[] = [];

    for (const adapter of adaptersWithSettings) {
      const fileName = adapter.getSettingsFileName()!;
      paths.push(join(realHome, adapter.getConfigDirName(), fileName));
    }

    for (const account of accounts) {
      if (account.isDefault || !account.homeDir) continue;
      for (const adapter of adaptersWithSettings) {
        const fileName = adapter.getSettingsFileName()!;
        paths.push(join(account.homeDir, adapter.getConfigDirName(), fileName));
      }
    }

    return paths;
  }

  /**
   * Ensure shared provider subdirectories are symlinked from the primary account.
   * For each registered provider, symlinks declared shared subdirs that exist
   * in the primary config dir but are missing in the account config dir.
   */
  private syncProviderSubdirSymlinks(accountHome: string): void {
    const realHome = homedir();

    for (const adapter of this.registry.getRegistered()) {
      const configDirName = adapter.getConfigDirName();
      const sharedSubdirs = adapter.getSharedConfigSubdirs();
      if (sharedSubdirs.length === 0) continue;

      const primaryConfigDir = join(realHome, configDirName);
      const accountConfigDir = join(accountHome, configDirName);

      for (const subdir of sharedSubdirs) {
        const sourcePath = join(primaryConfigDir, subdir);
        const targetPath = join(accountConfigDir, subdir);

        if (!existsSync(sourcePath) || existsSync(targetPath)) continue;

        try {
          symlinkSync(sourcePath, targetPath);
        } catch {
          logger.warn('accounts', 'Failed to symlink provider subdir', {
            source: sourcePath,
            target: targetPath,
          });
        }
      }
    }
  }
}
