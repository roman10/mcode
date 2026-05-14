import type { WebContents } from 'electron';
import type { HookEvent, SessionInfo, SessionStatus } from '../../shared/types';
import type { IpcPushContract } from '../../shared/ipc-contract';

export type SessionUpdateListener = (
  session: SessionInfo,
  previousStatus: SessionStatus | null,
) => void;

/**
 * Owns outbound `session:updated` / `hook:event` IPC and in-process
 * subscriptions to session lifecycle events.
 *
 * Two coalesced channels:
 *
 *   - **session:updated** (renderer-facing): `broadcastSessionUpdate(id)`
 *     queues the id and merges repeat calls within one event-loop tick into
 *     a single IPC send carrying the latest snapshot. Without this, bursts
 *     of hook events + state transitions fan out to dozens of renders per
 *     session per second.
 *   - **onSessionsChanged** (in-process): listeners fire once per
 *     coalesced flush; useful for cheap aggregate UI (dock badge, etc).
 *
 * One status-transition channel:
 *
 *   - **onSessionUpdated** (in-process): listeners fire on every status
 *     change with both new and previous status; used by TaskQueue,
 *     SleepBlocker, and the main process's command-bus.
 *
 * One direct-send channel:
 *
 *   - **broadcastHookEvent**: not coalesced — fires hook:event straight
 *     to the renderer. Hook events arrive in bursts during tool use; the
 *     only consumer (ActivityFeed) does not read session state when
 *     handling them, so coalescing them would not help.
 */
export class SessionBroadcaster {
  private readonly sessionListeners = new Set<SessionUpdateListener>();
  private readonly changeListeners = new Set<() => void>();
  private readonly pendingBroadcasts = new Set<string>();
  private flushTimer: NodeJS.Immediate | null = null;

  constructor(
    private readonly getWebContents: () => WebContents | null,
    private readonly getSession: (sessionId: string) => SessionInfo | null,
  ) {}

  /** Subscribe to status transitions (fires only when status actually changes). */
  onSessionUpdated(listener: SessionUpdateListener): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  /** Subscribe to "any session field changed" notifications. Fires once per flush. */
  onSessionsChanged(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Fire status-transition listeners. Errors in listeners are swallowed so a
   *  buggy subscriber cannot break the state machine. */
  notifyStatusTransition(session: SessionInfo, previousStatus: SessionStatus | null): void {
    for (const listener of this.sessionListeners) {
      try {
        listener(session, previousStatus);
      } catch {
        // Listener errors must not break session state transitions
      }
    }
  }

  /** Queue an outbound `session:updated` IPC. Merges with any pending
   *  broadcasts for the same sessionId within one event-loop tick. */
  broadcastSessionUpdate(sessionId: string): void {
    this.pendingBroadcasts.add(sessionId);
    if (this.flushTimer === null) {
      this.flushTimer = setImmediate(() => this.flush());
    }
  }

  /** Direct fire-and-forget send for hook events (not coalesced). */
  broadcastHookEvent(event: HookEvent): void {
    this.sendDirect('hook:event', event);
  }

  /** Direct fire-and-forget IPC push (not coalesced). Skips when the renderer
   *  isn't around — destroyed-window sends would throw. Use this for one-off
   *  lifecycle events; reach for `broadcastSessionUpdate` instead when the
   *  same id may fire many times in one tick. */
  sendDirect<K extends keyof IpcPushContract>(
    channel: K,
    ...args: IpcPushContract[K]['params']
  ): void {
    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send(channel, ...args);
    }
  }

  private flush(): void {
    this.flushTimer = null;
    if (this.pendingBroadcasts.size === 0) return;

    const ids = Array.from(this.pendingBroadcasts);
    this.pendingBroadcasts.clear();

    for (const id of ids) {
      const session = this.getSession(id);
      if (session) this.sendDirect('session:updated', session);
    }
    this.notifyChanged();
  }

  private notifyChanged(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch {
        // Listener errors must not break the broadcast pipeline
      }
    }
  }
}
