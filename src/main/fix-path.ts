import { execFileSync } from 'node:child_process';
import { logger } from './logger';

/**
 * Fix PATH for packaged macOS/Linux builds.
 *
 * GUI-launched apps (Dock/Finder/Spotlight) inherit a minimal system PATH
 * that excludes user-installed CLI tools. This reads the user's login shell
 * to get the full PATH, matching what a terminal session would see.
 */
export function fixPath(): void {
  if (process.platform === 'win32') return;

  const shell = process.env.SHELL || '/bin/zsh';

  try {
    const stdout = execFileSync(shell, ['-ilc', 'printf "%s" "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        // Prevent oh-my-zsh tmux plugin from launching tmux in the subshell
        TERM: 'dumb',
        ZSH_TMUX_AUTOSTART: 'false',
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    // Strip ANSI escape sequences that shells might emit during startup
    const cleaned = stdout.replace(
      // eslint-disable-next-line no-control-regex
      /[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
      '',
    );

    if (cleaned) {
      process.env.PATH = cleaned;
      logger.info('app', 'Fixed shell PATH', { shell });
    }
  } catch {
    logger.warn('app', 'Failed to read shell PATH, using system default', { shell });
  }
}
