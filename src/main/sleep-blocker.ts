import { powerSaveBlocker } from 'electron';
import type { SessionManager } from './session-manager';
import { getPreferenceBool, setPreferenceBool } from './preferences';
import { logger } from './logger';

const PREF_KEY = 'preventSleepEnabled';
const ACTIVE_STATUSES = new Set(['starting', 'active', 'idle', 'waiting']);

export class SleepBlocker {
  private blockerId: number | null = null;
  private enabled: boolean;
  private sessionManager: SessionManager | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.enabled = getPreferenceBool(PREF_KEY, true);
  }

  attach(sessionManager: SessionManager): void {
    this.sessionManager = sessionManager;
    this.unsubscribe = sessionManager.onSessionUpdated(() => {
      this.reconcile();
    });
    this.reconcile();
  }

  detach(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.sessionManager = null;
    this.releaseBlocker();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    setPreferenceBool(PREF_KEY, enabled);
    this.reconcile();
    logger.info('sleep', enabled ? 'Sleep prevention enabled' : 'Sleep prevention disabled');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isBlocking(): boolean {
    return this.blockerId !== null && powerSaveBlocker.isStarted(this.blockerId);
  }

  private reconcile(): void {
    if (!this.sessionManager) return;

    const hasActive = this.sessionManager
      .list()
      .some((s) => ACTIVE_STATUSES.has(s.status));
    const shouldBlock = this.enabled && hasActive;

    if (shouldBlock && !this.isBlocking()) {
      this.blockerId = powerSaveBlocker.start('prevent-app-suspension');
      logger.info('sleep', 'Sleep blocker acquired', { blockerId: this.blockerId });
    } else if (!shouldBlock && this.isBlocking()) {
      this.releaseBlocker();
    }
  }

  private releaseBlocker(): void {
    if (this.blockerId !== null) {
      try {
        powerSaveBlocker.stop(this.blockerId);
      } catch {
        // Already stopped or invalid — safe to ignore
      }
      logger.info('sleep', 'Sleep blocker released', { blockerId: this.blockerId });
      this.blockerId = null;
    }
  }
}
