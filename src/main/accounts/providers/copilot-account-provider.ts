import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import type { AccountProviderAdapter } from '../account-provider';
import type {
  AccountProfile,
  AuthStatusResult,
  CliAuthStatus,
  SessionCreateInput,
  SubscriptionUsage,
} from '../../../shared/types';

const execFileAsync = promisify(execFile);

class CopilotAccountProvider implements AccountProviderAdapter {
  readonly sessionType = 'copilot' as const;
  readonly supportsAccountProfiles = true;

  getConfigDirName(): string {
    return '.copilot';
  }

  /**
   * Returns env vars for Copilot config isolation.
   * NOTE: We do NOT override HOME — Copilot uses macOS Keychain which is
   * located via the real HOME. Overriding HOME breaks Keychain lookups.
   */
  getConfigEnv(accountHome: string): Record<string, string> {
    return {
      COPILOT_HOME: join(accountHome, '.copilot'),
    };
  }

  getSharedConfigSubdirs(): readonly string[] {
    // hooks/ is mcode-managed; no user-content subdirs identified for Copilot.
    return [];
  }

  async checkCliInstalled(): Promise<CliAuthStatus> {
    try {
      await execFileAsync('which', ['copilot']);
      return 'ok';
    } catch {
      return 'cli-not-found';
    }
  }

  async checkAuthStatus(account: AccountProfile): Promise<AuthStatusResult> {
    const copilotHome = account.isDefault
      ? (process.env.COPILOT_HOME ?? join(homedir(), '.copilot'))
      : join(account.homeDir!, '.copilot');

    const configPath = join(copilotHome, 'config.json');

    if (!existsSync(configPath)) {
      return { status: 'not-authenticated' };
    }

    try {
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as { logged_in_users?: unknown[] };

      const users = config.logged_in_users;
      if (!Array.isArray(users) || users.length === 0) {
        return { status: 'not-authenticated' };
      }

      // logged_in_users may be plain strings or objects with a github_user field
      const first = users[0];
      const username =
        typeof first === 'string'
          ? first
          : first !== null && typeof first === 'object' && 'github_user' in first
            ? String((first as Record<string, unknown>).github_user)
            : null;

      return { status: 'ok', identity: username, displayName: username };
    } catch {
      return { status: 'not-authenticated' };
    }
  }

  buildAuthTerminalInput(account: AccountProfile): SessionCreateInput | null {
    if (account.isDefault || !account.homeDir) return null;
    const copilotConfigDir = join(account.homeDir, '.copilot');
    return {
      cwd: account.homeDir,
      label: `Auth: ${account.name}`,
      sessionType: 'terminal',
      accountId: account.accountId,
      initialCommand: `copilot login --config-dir "${copilotConfigDir}"`,
    };
  }

  getInstallHelpUrl(): string | undefined {
    return 'https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started';
  }

  supportsSubscriptionUsage(): boolean {
    return false;
  }

  async getSubscriptionUsage(_account: AccountProfile, _force?: boolean): Promise<SubscriptionUsage | null> {
    return null;
  }
}

export function createCopilotAccountProvider(): AccountProviderAdapter {
  return new CopilotAccountProvider();
}
