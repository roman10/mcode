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
} from '../../../shared/types';

const execFileAsync = promisify(execFile);

class GeminiAccountProvider implements AccountProviderAdapter {
  readonly sessionType = 'gemini' as const;
  readonly supportsAccountProfiles = true;

  getConfigDirName(): string {
    return '.gemini';
  }

  /**
   * Returns env vars for Gemini config isolation.
   * Key difference: GEMINI_CLI_HOME points to the PARENT of .gemini/
   * (i.e., accountHome itself), not to the config dir directly.
   * GEMINI_FORCE_FILE_STORAGE bypasses the shared macOS Keychain entry
   * (gemini-cli-oauth / main-account) so each account stores credentials
   * in its own $GEMINI_CLI_HOME/.gemini/gemini-credentials.json.
   */
  getConfigEnv(accountHome: string): Record<string, string> {
    return {
      GEMINI_CLI_HOME: accountHome,
      GEMINI_FORCE_FILE_STORAGE: 'true',
    };
  }

  getSharedConfigSubdirs(): readonly string[] {
    return ['commands'];
  }

  getSharedSettingsKeys(): readonly string[] {
    return [];
  }

  getSettingsFileName(): null {
    // Gemini hook config is managed via settings.json through its own bridge, not shared settings.
    return null;
  }

  async checkCliInstalled(): Promise<CliAuthStatus> {
    try {
      await execFileAsync('which', ['gemini']);
      return 'ok';
    } catch {
      return 'cli-not-found';
    }
  }

  async checkAuthStatus(account: AccountProfile): Promise<AuthStatusResult> {
    const geminiHome = account.isDefault
      ? (process.env.GEMINI_CLI_HOME ?? homedir())
      : account.homeDir!;

    const authPath = join(geminiHome, '.gemini', 'google_accounts.json');

    if (!existsSync(authPath)) {
      return { status: 'not-authenticated' };
    }

    try {
      const raw = readFileSync(authPath, 'utf-8');
      const config = JSON.parse(raw) as { active?: string | null };

      if (!config.active) {
        return { status: 'not-authenticated' };
      }

      return { status: 'ok', identity: config.active, displayName: config.active };
    } catch {
      return { status: 'not-authenticated' };
    }
  }

  buildAuthTerminalInput(account: AccountProfile): SessionCreateInput | null {
    if (account.isDefault || !account.homeDir) return null;
    return {
      cwd: account.homeDir,
      label: `Auth: ${account.name} \u2014 run /auth`,
      sessionType: 'terminal',
      accountId: account.accountId,
      initialCommand: 'gemini',
    };
  }

  getInstallHelpUrl(): string | undefined {
    return 'https://github.com/google-gemini/gemini-cli';
  }
}

export function createGeminiAccountProvider(): AccountProviderAdapter {
  return new GeminiAccountProvider();
}
