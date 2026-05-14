/**
 * Per-session timer orchestration extracted from SessionManager.
 *
 * Four independent timer kinds, each keyed by sessionId:
 *
 * 1. **Pending detection** (setImmediate): coalesces a burst of pty.data
 *    chunks into a single `onDetect` call on the next tick, so sustained
 *    output doesn't saturate the main thread with sync DB+regex work.
 * 2. **Quiescence timer** (setTimeout): fires `onDetect` shortly after the
 *    pty buffer settles, catching quiescence-gated transitions (idle ❯,
 *    permission prompts) without waiting for the next safety poll.
 * 3. **Startup timer** (setTimeout): a per-session safety net that fires an
 *    arbitrary callback after a delay — used to unstick sessions stuck in
 *    `starting` state.
 * 4. **Auto-delete timer** (setTimeout): fires `onAutoDelete` after a short
 *    delay; used to garbage-collect ended Claude sessions that had no
 *    interaction.
 *
 * Arming the same kind of timer for an already-armed session replaces the
 * pending fire (last-write-wins semantics), except for auto-delete which is
 * idempotent (already-armed → no-op).
 */
export class SessionTimerRegistry {
  private readonly quiescenceTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingDetections = new Map<string, NodeJS.Immediate>();
  private readonly startupTimers = new Map<string, NodeJS.Timeout>();
  private readonly autoDeleteTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly opts: {
      quiescenceDelayMs: number;
      startupTimeoutMs: number;
      autoDeleteDelayMs: number;
      onDetect: (sessionId: string) => void;
      onAutoDelete: (sessionId: string) => void;
    },
  ) {}

  /** Arms both the immediate next-tick detection and the quiescence settle timer. */
  armDetection(sessionId: string): void {
    if (!this.pendingDetections.has(sessionId)) {
      const handle = setImmediate(() => {
        this.pendingDetections.delete(sessionId);
        this.opts.onDetect(sessionId);
      });
      this.pendingDetections.set(sessionId, handle);
    }

    const existing = this.quiescenceTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.quiescenceTimers.delete(sessionId);
      this.opts.onDetect(sessionId);
    }, this.opts.quiescenceDelayMs);
    this.quiescenceTimers.set(sessionId, timer);
  }

  /** Clears both the next-tick handle and the quiescence settle timer. Called on pty.exit. */
  clearDetection(sessionId: string): void {
    this.clearQuiescence(sessionId);
    this.clearPendingDetection(sessionId);
  }

  /** Replaces any existing startup timer for the session. */
  armStartup(sessionId: string, fn: () => void): void {
    const existing = this.startupTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.startupTimers.delete(sessionId);
      fn();
    }, this.opts.startupTimeoutMs);
    this.startupTimers.set(sessionId, timer);
  }

  /** Idempotent: a second arm while the first is pending is a no-op. */
  armAutoDelete(sessionId: string): void {
    if (this.autoDeleteTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.autoDeleteTimers.delete(sessionId);
      this.opts.onAutoDelete(sessionId);
    }, this.opts.autoDeleteDelayMs);
    this.autoDeleteTimers.set(sessionId, timer);
  }

  /** Clears every timer (across all four kinds) for one session. */
  clearForSession(sessionId: string): void {
    this.clearQuiescence(sessionId);
    this.clearPendingDetection(sessionId);
    this.clearStartup(sessionId);
    this.clearAutoDelete(sessionId);
  }

  /** Clears every pending timer across all sessions. Called on app shutdown. */
  shutdown(): void {
    for (const timer of this.quiescenceTimers.values()) clearTimeout(timer);
    this.quiescenceTimers.clear();
    for (const timer of this.startupTimers.values()) clearTimeout(timer);
    this.startupTimers.clear();
    for (const timer of this.autoDeleteTimers.values()) clearTimeout(timer);
    this.autoDeleteTimers.clear();
    for (const handle of this.pendingDetections.values()) clearImmediate(handle);
    this.pendingDetections.clear();
  }

  private clearQuiescence(sessionId: string): void {
    const timer = this.quiescenceTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.quiescenceTimers.delete(sessionId);
    }
  }

  private clearPendingDetection(sessionId: string): void {
    const handle = this.pendingDetections.get(sessionId);
    if (handle) {
      clearImmediate(handle);
      this.pendingDetections.delete(sessionId);
    }
  }

  private clearStartup(sessionId: string): void {
    const timer = this.startupTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.startupTimers.delete(sessionId);
    }
  }

  private clearAutoDelete(sessionId: string): void {
    const timer = this.autoDeleteTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.autoDeleteTimers.delete(sessionId);
    }
  }
}
