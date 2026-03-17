import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { WebContents } from 'electron';
import type { PtyManager } from './pty-manager';
import { getDb } from './db';
import { logger } from './logger';
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  HOOK_EVENT_RETENTION_DAYS,
  HOOK_TOOL_INPUT_MAX_BYTES,
  type PermissionMode,
} from '../shared/constants';
import type {
  SessionInfo,
  SessionType,
  SessionStatus,
  SessionAttentionLevel,
  SessionCreateInput,
  HookEvent,
  HookRuntimeInfo,
} from '../shared/types';

interface SessionRecord {
  session_id: string;
  label: string;
  cwd: string;
  permission_mode: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  claude_session_id: string | null;
  last_tool: string | null;
  last_event_at: string | null;
  attention_level: string;
  attention_reason: string | null;
  hook_mode: string;
  session_type: string;
}

function isClaudeCommand(command: string): boolean {
  const normalized = basename(command).toLowerCase();
  return normalized === 'claude' || normalized === 'claude.exe' || normalized === 'claude.cmd';
}

function serializeToolInput(
  toolInput: Record<string, unknown> | null,
): string | null {
  if (!toolInput) return null;

  const json = JSON.stringify(toolInput);
  if (json.length <= HOOK_TOOL_INPUT_MAX_BYTES) {
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

function toSessionInfo(row: SessionRecord): SessionInfo {
  return {
    sessionId: row.session_id,
    label: row.label,
    cwd: row.cwd,
    status: row.status as SessionStatus,
    permissionMode: (row.permission_mode as PermissionMode) ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    claudeSessionId: row.claude_session_id,
    lastTool: row.last_tool,
    lastEventAt: row.last_event_at,
    attentionLevel: row.attention_level as SessionAttentionLevel,
    attentionReason: row.attention_reason,
    hookMode: row.hook_mode as 'live' | 'fallback',
    sessionType: row.session_type as SessionType,
  };
}

export class SessionManager {
  private ptyManager: PtyManager;
  private getWebContents: () => WebContents | null;
  private hookRuntimeGetter: () => HookRuntimeInfo;

  constructor(
    ptyManager: PtyManager,
    getWebContents: () => WebContents | null,
    hookRuntimeGetter: () => HookRuntimeInfo,
  ) {
    this.ptyManager = ptyManager;
    this.getWebContents = getWebContents;
    this.hookRuntimeGetter = hookRuntimeGetter;
  }

  create(input: SessionCreateInput): SessionInfo {
    const sessionId = randomUUID();
    const cwd = input.cwd;
    const label = input.label || basename(cwd);
    const startedAt = new Date().toISOString();
    const sessionType = input.sessionType ?? 'claude';

    const isTerminal = sessionType === 'terminal';

    const command = isTerminal
      ? (process.env.SHELL || '/bin/zsh')
      : (input.command ?? 'claude');

    const isClaude = !isTerminal && isClaudeCommand(command);

    // Block Claude startup until the hook subsystem reaches a terminal runtime state.
    const hookRuntime = this.hookRuntimeGetter();
    if (isClaude && hookRuntime.state === 'initializing') {
      throw new Error('Hook system is still initializing. Retry session creation shortly.');
    }

    const hookMode = isClaude && hookRuntime.state === 'ready' ? 'live' : 'fallback';

    // Build args for CLI (only for Claude sessions)
    const args: string[] = [];
    if (!isTerminal) {
      if (input.permissionMode) {
        args.push('--permission-mode', input.permissionMode);
      }
      if (input.initialPrompt) {
        args.push(input.initialPrompt);
      }
    }

    // Insert DB row FIRST so that onFirstData/onExit callbacks can UPDATE it.
    // If spawn fails, we delete the row.
    const db = getDb();
    db.prepare(
      `INSERT INTO sessions (session_id, label, cwd, permission_mode, status, started_at, hook_mode, session_type)
       VALUES (?, ?, ?, ?, 'starting', ?, ?, ?)`,
    ).run(sessionId, label, cwd, isTerminal ? null : (input.permissionMode ?? null), startedAt, hookMode, sessionType);

    try {
      this.ptyManager.spawn({
        id: sessionId,
        command,
        cwd,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        args: args.length > 0 ? args : undefined,
        env: { MCODE_SESSION_ID: sessionId },
        onFirstData: () => {
          // In fallback mode, PTY data drives the starting -> active transition
          // In live mode, SessionStart hook drives it
          if (hookMode === 'fallback') {
            this.updateStatus(sessionId, 'active');
          }
        },
        onExit: () => {
          this.updateStatus(sessionId, 'ended');
        },
      });
    } catch (err) {
      // Spawn failed — remove the row we just inserted
      db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
      throw err;
    }

    logger.info('session', 'Created session', { sessionId, cwd, label, hookMode });

    const session = this.get(sessionId)!;
    return session;
  }

  updateStatus(sessionId: string, status: SessionStatus): void {
    const db = getDb();

    // Idempotency guard — skip if already in target state
    const current = db
      .prepare('SELECT status FROM sessions WHERE session_id = ?')
      .get(sessionId) as { status: string } | undefined;
    if (!current || current.status === status) return;
    // Don't transition away from ended
    if (current.status === 'ended') return;

    if (status === 'ended') {
      db.prepare(
        `UPDATE sessions SET status = ?, ended_at = ?, attention_level = 'none', attention_reason = NULL WHERE session_id = ?`,
      ).run(status, new Date().toISOString(), sessionId);
    } else {
      db.prepare(
        `UPDATE sessions SET status = ? WHERE session_id = ?`,
      ).run(status, sessionId);
    }

    logger.info('session', 'Status changed', { sessionId, status });
    this.broadcastSessionUpdate(sessionId);
  }

  /** Handle a hook event from the hook server or injected via MCP. */
  handleHookEvent(sessionId: string, event: HookEvent): boolean {
    const db = getDb();

    // Verify session exists
    const row = db
      .prepare('SELECT status, attention_level FROM sessions WHERE session_id = ?')
      .get(sessionId) as { status: string; attention_level: string } | undefined;
    if (!row) {
      logger.warn('session', 'Hook event for unknown session', { sessionId, event: event.hookEventName });
      return false;
    }

    // Don't process events for ended sessions
    if (row.status === 'ended') return true;

    // Persist event
    this.persistEvent(sessionId, event);

    // Persist claude_session_id if present
    if (event.claudeSessionId) {
      db.prepare(
        'UPDATE sessions SET claude_session_id = ? WHERE session_id = ?',
      ).run(event.claudeSessionId, sessionId);
    }

    // Apply state transitions
    const currentStatus = row.status as SessionStatus;
    const currentAttention = row.attention_level as SessionAttentionLevel;
    let newStatus: SessionStatus = currentStatus;
    let newAttention: SessionAttentionLevel = currentAttention;
    let attentionReason: string | null = null;
    let lastTool: string | null = null;

    switch (event.hookEventName) {
      case 'SessionStart':
        if (currentStatus === 'starting') {
          newStatus = 'active';
        }
        break;

      case 'PreToolUse':
        lastTool = event.toolName;
        break;

      case 'PostToolUse':
        if (currentStatus === 'waiting') {
          newStatus = 'active';
        }
        lastTool = event.toolName;
        break;

      case 'Stop':
        newStatus = 'idle';
        // Set low only if was active (avoid noise on repeated stops)
        if (currentStatus === 'active') {
          if (currentAttention === 'none') {
            newAttention = 'low';
            attentionReason = 'Claude finished its turn';
          }
        }
        break;

      case 'PermissionRequest':
        newStatus = 'waiting';
        newAttention = 'high';
        attentionReason = event.toolName
          ? `Permission needed: ${event.toolName}`
          : 'Permission needed';
        break;

      case 'Notification':
        // No status change
        if (currentAttention !== 'high') {
          newAttention = 'medium';
          attentionReason = 'Notification from Claude';
        }
        break;

      case 'PostToolUseFailure':
        if (currentAttention !== 'high') {
          newAttention = 'medium';
          attentionReason = event.toolName
            ? `Tool failed: ${event.toolName}`
            : 'Tool failure';
        }
        break;

      case 'SessionEnd':
        newStatus = 'ended';
        newAttention = 'none';
        attentionReason = null;
        break;
    }

    // Build update
    const updates: string[] = [];
    const params: unknown[] = [];

    if (newStatus !== currentStatus) {
      updates.push('status = ?');
      params.push(newStatus);
      if (newStatus === 'ended') {
        updates.push('ended_at = ?');
        params.push(new Date().toISOString());
      }
    }

    if (newAttention !== currentAttention) {
      updates.push('attention_level = ?');
      params.push(newAttention);
      updates.push('attention_reason = ?');
      params.push(attentionReason);
    }

    if (lastTool) {
      updates.push('last_tool = ?');
      params.push(lastTool);
    }

    updates.push('last_event_at = ?');
    params.push(event.createdAt);

    if (updates.length > 0) {
      params.push(sessionId);
      db.prepare(
        `UPDATE sessions SET ${updates.join(', ')} WHERE session_id = ?`,
      ).run(...params);
    }

    this.broadcastSessionUpdate(sessionId);
    this.broadcastHookEvent(event);
    return true;
  }

  private persistEvent(sessionId: string, event: HookEvent): void {
    const db = getDb();
    const toolInput = serializeToolInput(event.toolInput);

    db.prepare(
      `INSERT INTO events (session_id, claude_session_id, hook_event_name, tool_name, tool_input, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      event.claudeSessionId,
      event.hookEventName,
      event.toolName,
      toolInput,
      JSON.stringify(event.payload),
      event.createdAt,
    );
  }

  broadcastSessionUpdate(sessionId: string): void {
    const session = this.get(sessionId);
    if (!session) return;
    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('session:updated', session);
    }
  }

  private broadcastHookEvent(event: HookEvent): void {
    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('hook:event', event);
    }
  }

  async kill(sessionId: string): Promise<void> {
    // PTY's onExit callback handles the status transition to 'ended',
    // so we don't call updateStatus here (avoids double transition).
    await this.ptyManager.kill(sessionId);
    logger.info('session', 'Killed session', { sessionId });
  }

  get(sessionId: string): SessionInfo | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM sessions WHERE session_id = ?')
      .get(sessionId) as SessionRecord | undefined;
    return row ? toSessionInfo(row) : null;
  }

  list(): SessionInfo[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM sessions ORDER BY started_at DESC')
      .all() as SessionRecord[];
    return rows.map(toSessionInfo);
  }

  setLabel(sessionId: string, label: string): void {
    const db = getDb();
    db.prepare('UPDATE sessions SET label = ? WHERE session_id = ?').run(
      label,
      sessionId,
    );
    this.broadcastSessionUpdate(sessionId);
  }

  clearAttention(sessionId: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE sessions SET attention_level = 'none', attention_reason = NULL WHERE session_id = ?`,
    ).run(sessionId);
    this.broadcastSessionUpdate(sessionId);
  }

  clearAllAttention(): void {
    const db = getDb();
    const changed = db
      .prepare(
        `SELECT session_id FROM sessions WHERE attention_level != 'none'`,
      )
      .all() as { session_id: string }[];

    if (changed.length === 0) return;

    db.prepare(
      `UPDATE sessions SET attention_level = 'none', attention_reason = NULL WHERE attention_level != 'none'`,
    ).run();

    for (const row of changed) {
      this.broadcastSessionUpdate(row.session_id);
    }
  }

  /** Look up an mcode session ID by Claude's session_id. */
  lookupByClaudeSessionId(claudeSessionId: string): string | null {
    const db = getDb();
    const row = db
      .prepare('SELECT session_id FROM sessions WHERE claude_session_id = ?')
      .get(claudeSessionId) as { session_id: string } | undefined;
    return row?.session_id ?? null;
  }

  /** Get recent events for a session. */
  getRecentEvents(sessionId: string, limit = 50): HookEvent[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(sessionId, limit) as Array<{
        session_id: string;
        claude_session_id: string | null;
        hook_event_name: string;
        tool_name: string | null;
        tool_input: string | null;
        payload: string;
        created_at: string;
      }>;

    return rows.map((r) => ({
      sessionId: r.session_id,
      claudeSessionId: r.claude_session_id,
      hookEventName: r.hook_event_name,
      toolName: r.tool_name,
      toolInput: tryParseJson<Record<string, unknown>>(r.tool_input),
      createdAt: r.created_at,
      payload: tryParseJson<Record<string, unknown>>(r.payload) ?? {},
    }));
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

  /** Mark all non-ended sessions as ended. Called on app quit. */
  endAllActive(): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE sessions SET status = 'ended', ended_at = ?, attention_level = 'none', attention_reason = NULL WHERE status != 'ended'`,
    ).run(now);
    logger.info('session', 'Marked all active sessions as ended');
  }

  // --- Layout persistence ---

  saveLayout(mosaicTree: unknown, sidebarWidth?: number): void {
    const db = getDb();
    if (mosaicTree === null || mosaicTree === undefined) {
      db.prepare('DELETE FROM layout_state WHERE id = 1').run();
      return;
    }
    const json = JSON.stringify(mosaicTree);
    const width = sidebarWidth ?? 280;
    db.prepare(
      `INSERT INTO layout_state (id, mosaic_tree, sidebar_width, updated_at)
       VALUES (1, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET mosaic_tree = ?, sidebar_width = ?, updated_at = datetime('now')`,
    ).run(json, width, json, width);
  }

  loadLayout(): { mosaicTree: unknown; sidebarWidth: number } | null {
    const db = getDb();
    const row = db
      .prepare('SELECT mosaic_tree, sidebar_width FROM layout_state WHERE id = 1')
      .get() as { mosaic_tree: string; sidebar_width: number } | undefined;
    if (!row) return null;
    try {
      return {
        mosaicTree: JSON.parse(row.mosaic_tree),
        sidebarWidth: row.sidebar_width,
      };
    } catch {
      return null;
    }
  }
}
