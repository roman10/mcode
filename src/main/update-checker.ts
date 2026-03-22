import { app, dialog, shell } from 'electron';
import { logger } from './logger';
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_DELAY_MS,
} from '../shared/constants';

const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const RELEASES_URL_PREFIX = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/`;

interface UpdateInfo {
  version: string;
  url: string;
}

function isNewer(remote: string, current: string): boolean {
  const r = remote.replace(/^v/, '').split('.').map(Number);
  const c = current.split('.').map(Number);
  if (r.some(isNaN) || c.some(isNaN)) return false;
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const rv = r[i] ?? 0;
    const cv = c[i] ?? 0;
    if (rv > cv) return true;
    if (rv < cv) return false;
  }
  return false;
}

export class UpdateChecker {
  private getWebContents: () => Electron.WebContents | null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private latestUpdate: UpdateInfo | null = null;

  constructor(getWebContents: () => Electron.WebContents | null) {
    this.getWebContents = getWebContents;
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

  async check(): Promise<boolean> {
    try {
      const res = await fetch(RELEASES_API, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
      });
      if (!res.ok) return false;

      const data = await res.json();
      if (data.prerelease || data.draft) return false;

      const tagName: string = data.tag_name;
      const htmlUrl: string = data.html_url;
      const currentVersion = app.getVersion();

      if (!isNewer(tagName, currentVersion)) return false;
      if (!htmlUrl.startsWith(RELEASES_URL_PREFIX)) return false;

      const version = tagName.replace(/^v/, '');

      // Skip if we already notified for this version
      if (this.latestUpdate?.version === version) return true;

      this.latestUpdate = { version, url: htmlUrl };

      const wc = this.getWebContents();
      if (wc && !wc.isDestroyed()) {
        wc.send('app:update-available', { version });
      }

      logger.info('update', `Update available: v${version}`, { url: htmlUrl });
      return true;
    } catch {
      return false;
    }
  }

  async checkManual(): Promise<void> {
    const found = await this.check();
    if (found) {
      // Re-send IPC in case user dismissed the pill and used menu to re-check
      const wc = this.getWebContents();
      if (wc && !wc.isDestroyed() && this.latestUpdate) {
        wc.send('app:update-available', { version: this.latestUpdate.version });
      }
    } else {
      dialog.showMessageBox({
        type: 'info',
        title: 'No Updates Available',
        message: `You're up to date (v${app.getVersion()}).`,
        buttons: ['OK'],
      });
    }
  }

  openUpdatePage(): void {
    if (!this.latestUpdate) return;
    const { url } = this.latestUpdate;
    if (url.startsWith(RELEASES_URL_PREFIX)) {
      shell.openExternal(url);
    }
  }
}
