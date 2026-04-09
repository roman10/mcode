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

/** Map raw auth_mode values to user-friendly display names. */
function formatAuthMode(authMode: string): string {
  switch (authMode) {
    case 'chatgpt': return 'ChatGPT';
    case 'api_key': return 'API Key';
    case 'device_code': return 'Device Code';
    default: return authMode;
  }
}

class CodexAccountProvider implements AccountProviderAdapter {
  readonly sessionType = 'codex' as const;
  readonly supportsAccountProfiles = true;

  getConfigDirName(): string {
    return '.codex';
  }

  /**
   * Returns env vars for Codex config isolation.
   * Codex stores auth in file-based auth.json (no macOS Keychain dependency),
   * so CODEX_HOME alone is sufficient for full isolation.
   */
  getConfigEnv(accountHome: string): Record<string, string> {
    return {
      CODEX_HOME: join(accountHome, '.codex'),
    };
  }

  getSharedConfigSubdirs(): readonly string[] {
    // User-authored content that should be shared across accounts.
    return ['rules', 'skills', 'memories'];
  }

  getSharedSettingsKeys(): readonly string[] {
    // Codex uses config.toml, not a JSON settings file with shared keys.
    return [];
  }

  getSettingsFileName(): null {
    // Codex hook config is managed via hooks.json through its own bridge, not settings.json.
    return null;
  }

  async checkCliInstalled(): Promise<CliAuthStatus> {
    try {
      await execFileAsync('which', ['codex']);
      return 'ok';
    } catch {
      return 'cli-not-found';
    }
  }

  async checkAuthStatus(account: AccountProfile): Promise<AuthStatusResult> {
    const codexHome = account.isDefault
      ? (process.env.CODEX_HOME ?? join(homedir(), '.codex'))
      : join(account.homeDir!, '.codex');

    const authPath = join(codexHome, 'auth.json');

    if (!existsSync(authPath)) {
      return { status: 'not-authenticated' };
    }

    try {
      const raw = readFileSync(authPath, 'utf-8');
      const auth = JSON.parse(raw) as { auth_mode?: string };

      if (!auth.auth_mode) {
        return { status: 'not-authenticated' };
      }

      const displayName = formatAuthMode(auth.auth_mode);
      return { status: 'ok', identity: auth.auth_mode, displayName };
    } catch {
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
      initialCommand: 'codex login',
    };
  }

  getInstallHelpUrl(): string | undefined {
    return 'https://codex.openai.com/';
  }
}

export function createCodexAccountProvider(): AccountProviderAdapter {
  return new CodexAccountProvider();
}
