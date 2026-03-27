import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { app, dialog, shell } from 'electron';
import { logger } from './logger';
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_DELAY_MS,
} from '../shared/constants';

const RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

export class AutoUpdater {
  private getWebContents: () => Electron.WebContents | null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(getWebContents: () => Electron.WebContents | null) {
    this.getWebContents = getWebContents;

    // Don't auto-download; user triggers download from the StatusBar pill
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.send('app:update-available', { version: info.version });
      logger.info('updater', `Update available: v${info.version}`);
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.send('app:update-download-progress', { percent: Math.round(progress.percent) });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.send('app:update-downloaded', { version: info.version });
      logger.info('updater', `Update downloaded: v${info.version}`);
    });

    autoUpdater.on('error', (err: Error) => {
      this.send('app:update-error', { message: err.message });
      logger.error('updater', 'Update error', { error: err.message });
    });
  }

  start(): void {
    if (!app.isPackaged) return;

    this.timeout = setTimeout(() => {
      this.check();
      this.interval = setInterval(() => this.check(), UPDATE_CHECK_INTERVAL_MS);
    }, UPDATE_CHECK_DELAY_MS);
  }

  stop(): void {
    if (this.timeout) clearTimeout(this.timeout);
    if (this.interval) clearInterval(this.interval);
    this.timeout = null;
    this.interval = null;
  }

  async check(): Promise<void> {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      logger.error('updater', 'Check failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async checkManual(): Promise<void> {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result || !result.updateInfo || result.updateInfo.version === app.getVersion()) {
        dialog.showMessageBox({
          type: 'info',
          title: 'No Updates Available',
          message: `You're up to date (v${app.getVersion()}).`,
          buttons: ['OK'],
        });
      } else {
        // Re-send IPC in case user dismissed the pill and used menu to re-check.
        // electron-updater may not re-emit update-available for an already-detected version.
        this.send('app:update-available', { version: result.updateInfo.version });
      }
    } catch {
      dialog.showMessageBox({
        type: 'error',
        title: 'Update Check Failed',
        message: 'Could not check for updates. Please try again later.',
        buttons: ['OK'],
      });
    }
  }

  downloadUpdate(): void {
    autoUpdater.downloadUpdate().catch((err: unknown) => {
      logger.error('updater', 'Download failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /** Called from index.ts after setting isQuitting = true */
  installUpdate(): void {
    autoUpdater.quitAndInstall(false, true);
  }

  /** Fallback: open GitHub releases page in browser (used when download fails) */
  openReleasePage(): void {
    shell.openExternal(RELEASES_URL);
  }

  private send(channel: string, data: Record<string, unknown>): void {
    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send(channel, data);
    }
  }
}
