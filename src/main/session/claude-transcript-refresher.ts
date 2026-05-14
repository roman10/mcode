import { stat as fsStat } from 'node:fs/promises';
import { logger } from '../logger';

/**
 * Coalesces transcript-driven Claude model refreshes during hook bursts.
 *
 * Each Stop hook (and several other events) want to re-read the JSONL
 * transcript and extract the model name. During an active conversation
 * these events arrive faster than file I/O completes, so a naive
 * "re-read on every event" path would queue redundant work. This state
 * machine guarantees:
 *
 *   1. Within a delay window after the most recent schedule(), at most
 *      one refresh is *in flight* per session.
 *   2. If another schedule() lands while a refresh is in flight, exactly
 *      one follow-up refresh runs after the in-flight one settles.
 *   3. If the transcript file's size+mtime hasn't changed since the last
 *      successful refresh, the file isn't re-read (freshness cache).
 *
 * The owner provides `onTranscriptChanged(sessionId, transcriptPath)`
 * which actually reads the transcript and applies whatever side effect
 * (e.g., updating the session's detected model).
 */
interface RefreshState {
  timer: NodeJS.Timeout | null;
  queuedTranscriptPath: string | null;
  inFlight: Promise<void> | null;
  lastFreshnessKey: string | null;
}

export class ClaudeTranscriptRefresher {
  private readonly states = new Map<string, RefreshState>();

  constructor(
    private readonly onTranscriptChanged: (sessionId: string, transcriptPath: string) => Promise<void>,
  ) {}

  /** Queue a refresh for `sessionId` against `transcriptPath`, firing after `delayMs`. */
  schedule(sessionId: string, transcriptPath: string, delayMs: number): void {
    const state = this.getOrCreate(sessionId);
    state.queuedTranscriptPath = transcriptPath;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.flush(sessionId);
    }, delayMs);
  }

  /** Cancel any pending refresh for `sessionId`. */
  clear(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    this.states.delete(sessionId);
  }

  /** Clear every pending refresh across all sessions. Called on app shutdown. */
  shutdown(): void {
    for (const state of this.states.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.states.clear();
  }

  private getOrCreate(sessionId: string): RefreshState {
    const existing = this.states.get(sessionId);
    if (existing) return existing;
    const state: RefreshState = {
      timer: null,
      queuedTranscriptPath: null,
      inFlight: null,
      lastFreshnessKey: null,
    };
    this.states.set(sessionId, state);
    return state;
  }

  private async flush(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state || state.inFlight) return;
    const transcriptPath = state.queuedTranscriptPath;
    if (!transcriptPath) return;
    state.queuedTranscriptPath = null;
    state.inFlight = this.refresh(sessionId, transcriptPath, state)
      .catch((error) => {
        logger.warn('session', 'Failed to refresh Claude model from transcript', {
          sessionId,
          transcriptPath,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        state.inFlight = null;
        if (state.queuedTranscriptPath) {
          void this.flush(sessionId);
          return;
        }
        if (!state.timer) this.states.delete(sessionId);
      });
  }

  private async refresh(sessionId: string, transcriptPath: string, state: RefreshState): Promise<void> {
    let stats;
    try {
      stats = await fsStat(transcriptPath);
    } catch {
      state.lastFreshnessKey = null;
      return;
    }
    const freshnessKey = `${transcriptPath}:${stats.size}:${stats.mtimeMs}`;
    if (state.lastFreshnessKey === freshnessKey) return;
    await this.onTranscriptChanged(sessionId, transcriptPath);
    state.lastFreshnessKey = freshnessKey;
  }
}
