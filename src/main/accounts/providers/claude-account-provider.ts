import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AccountProviderAdapter } from '../account-provider';
import { fetchSubscriptionUsage } from '../../claude-subscription-fetcher';
import type { AccountProfile, AuthStatusResult, CliAuthStatus, SessionCreateInput, SubscriptionUsage } from '../../../shared/types';

const execFileAsync = promisify(execFile);

/** Subdirs inside .claude/ that are safe to share across accounts via symlink. */
const SHARED_SUBDIRS = ['commands', 'skills', 'plugins', 'projects'] as const;

class ClaudeAccountProvider implements AccountProviderAdapter {
  readonly sessionType = 'claude' as const;
  readonly supportsAccountProfiles = true;

  getConfigDirName(): string {
    return '.claude';
  }

  getConfigEnv(accountHome: string): Record<string, string> {
    return {
      HOME: accountHome,
      CLAUDE_CONFIG_DIR: join(accountHome, '.claude'),
    };
  }

  getSharedConfigSubdirs(): readonly string[] {
    return SHARED_SUBDIRS;
  }

  getSettingsFileName(): string {
    return 'settings.json';
  }

  async checkCliInstalled(): Promise<CliAuthStatus> {
    try {
      await execFileAsync('which', ['claude']);
      return 'ok';
    } catch {
      return 'cli-not-found';
    }
  }

  async checkAuthStatus(account: AccountProfile): Promise<AuthStatusResult> {
    const env = account.isDefault
      ? { ...process.env }
      : { ...process.env, HOME: account.homeDir!, CLAUDE_CONFIG_DIR: join(account.homeDir!, '.claude') };

    try {
      const { stdout } = await execFileAsync('claude', ['auth', 'status', '--json'], { env });
      const status = JSON.parse(stdout) as { loggedIn?: boolean; email?: string };
      if (status.loggedIn) {
        return { status: 'ok', email: status.email, identity: status.email };
      }
      return { status: 'not-authenticated' };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { status: 'cli-not-found' };
      }
      return { status: 'not-authenticated' };
    }
  }

  buildAuthTerminalInput(account: AccountProfile): SessionCreateInput | null {
    if (account.isDefault || !account.homeDir) return null;
    return {
      cwd: account.homeDir,
      label: `Auth: ${account.name}`,
      sessionType: 'terminal',
      accountId: account.accountId,
      initialCommand: 'claude auth login',
    };
  }

  getInstallHelpUrl(): string | undefined {
    return 'https://docs.anthropic.com/en/docs/claude-code/overview';
  }

  supportsSubscriptionUsage(): boolean {
    return true;
  }

  async getSubscriptionUsage(account: AccountProfile, force?: boolean): Promise<SubscriptionUsage | null> {
    return fetchSubscriptionUsage(account, force);
  }
}

export function createClaudeAccountProvider(): AccountProviderAdapter {
  return new ClaudeAccountProvider();
}
