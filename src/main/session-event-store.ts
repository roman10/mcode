import { getDb } from './db';
import { logger } from './logger';
import { HOOK_EVENT_RETENTION_DAYS } from '../shared/constants';
import type { HookEvent, SessionStatus } from '../shared/types';

function serializeToolInput(
  toolInput: Record<string, unknown> | null,
  maxBytes: number,
): string | null {
  if (!toolInput) return null;

  const json = JSON.stringify(toolInput);
  if (json.length <= maxBytes) {
    return json;
  }

  return JSON.stringify({
    _truncated: true,
    _originalLength: json.length,
  });
}

function tryParseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

interface EventRow {
  session_id: string;
  claude_session_id: string | null;
  hook_event_name: string;
  tool_name: string | null;
  tool_input: string | null;
  payload: string;
  created_at: string;
  session_status: string | null;
}

function rowToHookEvent(r: EventRow): HookEvent {
  return {
    sessionId: r.session_id,
    claudeSessionId: r.claude_session_id,
    hookEventName: r.hook_event_name,
    toolName: r.tool_name,
    toolInput: tryParseJson<Record<string, unknown>>(r.tool_input),
    createdAt: r.created_at,
    payload: tryParseJson<Record<string, unknown>>(r.payload) ?? {},
    sessionStatus: (r.session_status as SessionStatus) ?? undefined,
  };
}

export class SessionEventStore {
  private toolInputMaxBytes: number;

  constructor(toolInputMaxBytes: number) {
    this.toolInputMaxBytes = toolInputMaxBytes;
  }

  /** Persist a hook event to the database. */
  persistEvent(sessionId: string, event: HookEvent, sessionStatus: SessionStatus): void {
    const db = getDb();
    const toolInput = serializeToolInput(event.toolInput, this.toolInputMaxBytes);

    db.prepare(
      `INSERT INTO events (session_id, claude_session_id, hook_event_name, tool_name, tool_input, payload, created_at, session_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      event.claudeSessionId,
      event.hookEventName,
      event.toolName,
      toolInput,
      JSON.stringify(event.payload),
      event.createdAt,
      sessionStatus,
    );
  }

  /** Get recent events for a session. */
  getRecentEvents(sessionId: string, limit = 50): HookEvent[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(sessionId, limit) as EventRow[];

    return rows.map(rowToHookEvent);
  }

  /** Get recent events across all sessions. */
  getRecentAllEvents(limit = 200): HookEvent[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM events ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as EventRow[];

    return rows.map(rowToHookEvent);
  }

  /** Delete all hook events from the database. */
  clearAllEvents(): void {
    const db = getDb();
    db.prepare('DELETE FROM events').run();
  }

  /** Prune events older than retention period. */
  pruneOldEvents(): void {
    const db = getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HOOK_EVENT_RETENTION_DAYS);
    const result = db
      .prepare('DELETE FROM events WHERE created_at < ?')
      .run(cutoff.toISOString());
    if (result.changes > 0) {
      logger.info('session', 'Pruned old events', { count: result.changes });
    }
  }
}
