import { getDb } from '../db';
import type {
  SessionInfo,
  SessionStatus,
  SessionAttentionLevel,
  SessionType,
  SessionDefaults,
} from '../../shared/types';
import type { EffortLevel, PermissionMode } from '../../shared/constants';

// ---------------------------------------------------------------------------
// DB row shape (matches the `sessions` table)
// ---------------------------------------------------------------------------

export interface SessionRecord {
  session_id: string;
  label: string;
  label_source: string;
  cwd: string;
  permission_mode: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  command: string | null;
  claude_session_id: string | null;
  codex_thread_id: string | null;
  gemini_session_id: string | null;
  copilot_session_id: string | null;
  last_tool: string | null;
  last_event_at: string | null;
  attention_level: string;
  attention_reason: string | null;
  hook_mode: string;
  session_type: string;
  terminal_config: string;
  effort: string | null;
  enable_auto_mode: number | null;
  allow_bypass_permissions: number | null;
  worktree: string | null;
  account_id: string | null;
  auto_close: number;
  model: string | null;
  pre_detach_status: string | null;
}

// ---------------------------------------------------------------------------
// Domain mapper
// ---------------------------------------------------------------------------

export function toSessionInfo(row: SessionRecord): SessionInfo {
  return {
    sessionId: row.session_id,
    label: row.label,
    cwd: row.cwd,
    status: row.status as SessionStatus,
    permissionMode: (row.permission_mode as PermissionMode) ?? undefined,
    effort: (row.effort as EffortLevel) ?? undefined,
    enableAutoMode: row.enable_auto_mode === 1 ? true : undefined,
    allowBypassPermissions: row.allow_bypass_permissions === 1 ? true : undefined,
    worktree: row.worktree,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    codexThreadId: row.codex_thread_id,
    claudeSessionId: row.claude_session_id,
    geminiSessionId: row.gemini_session_id,
    copilotSessionId: row.copilot_session_id,
    lastTool: row.last_tool,
    lastEventAt: row.last_event_at,
    attentionLevel: row.attention_level as SessionAttentionLevel,
    attentionReason: row.attention_reason,
    hookMode: row.hook_mode as 'live' | 'fallback',
    sessionType: row.session_type as SessionType,
    terminalConfig: JSON.parse(row.terminal_config || '{}'),
    accountId: row.account_id,
    autoClose: row.auto_close === 1,
    model: row.model,
  };
}

// ---------------------------------------------------------------------------
// Typed partial for the generic update function
// ---------------------------------------------------------------------------

export interface SessionUpdate {
  status?: string;
  endedAt?: string | null;
  label?: string;
  labelSource?: string;
  autoClose?: number;
  model?: string | null;
  claudeSessionId?: string;
  codexThreadId?: string;
  geminiSessionId?: string;
  copilotSessionId?: string;
  worktree?: string;
  accountId?: string | null;
  attentionLevel?: string;
  attentionReason?: string | null;
  hookMode?: string;
  lastTool?: string | null;
  lastEventAt?: string | null;
  preDetachStatus?: string | null;
  terminalConfig?: string;
  permissionMode?: string | null;
  effort?: string | null;
  enableAutoMode?: number | null;
  allowBypassPermissions?: number | null;
}

const FIELD_TO_COLUMN: Record<string, string> = {
  status: 'status',
  endedAt: 'ended_at',
  label: 'label',
  labelSource: 'label_source',
  autoClose: 'auto_close',
  model: 'model',
  claudeSessionId: 'claude_session_id',
  codexThreadId: 'codex_thread_id',
  geminiSessionId: 'gemini_session_id',
  copilotSessionId: 'copilot_session_id',
  worktree: 'worktree',
  accountId: 'account_id',
  attentionLevel: 'attention_level',
  attentionReason: 'attention_reason',
  hookMode: 'hook_mode',
  lastTool: 'last_tool',
  lastEventAt: 'last_event_at',
  preDetachStatus: 'pre_detach_status',
  terminalConfig: 'terminal_config',
  permissionMode: 'permission_mode',
  effort: 'effort',
  enableAutoMode: 'enable_auto_mode',
  allowBypassPermissions: 'allow_bypass_permissions',
};

// ---------------------------------------------------------------------------
// INSERT data
// ---------------------------------------------------------------------------

export interface SessionInsertData {
  sessionId: string;
  label: string;
  labelSource?: string;
  cwd: string;
  permissionMode?: string | null;
  startedAt: string;
  command?: string | null;
  hookMode: string;
  sessionType: string;
  effort?: string | null;
  enableAutoMode?: number | null;
  allowBypassPermissions?: number | null;
  worktree?: string | null;
  accountId?: string | null;
  autoClose?: number;
  model?: string | null;
  claudeSessionId?: string | null;
}

// ---------------------------------------------------------------------------
// Row projections for targeted queries
// ---------------------------------------------------------------------------

export interface SessionHookStateRow {
  status: string;
  attention_level: string;
  cwd: string;
  worktree: string | null;
  last_tool: string | null;
  model: string | null;
  claude_session_id: string | null;
  session_type: string;
  gemini_session_id: string | null;
  copilot_session_id: string | null;
}

export interface PollableSessionRow {
  session_id: string;
  status: string;
  attention_level: string;
  last_tool: string | null;
  session_type: string;
}

// ===================================================================
// READ functions (18)
// ===================================================================

export function getSession(id: string): SessionInfo | null {
  const row = getDb()
    .prepare('SELECT * FROM sessions WHERE session_id = ?')
    .get(id) as SessionRecord | undefined;
  return row ? toSessionInfo(row) : null;
}

export function getSessionRecord(id: string): SessionRecord | null {
  return (getDb()
    .prepare('SELECT * FROM sessions WHERE session_id = ?')
    .get(id) as SessionRecord | undefined) ?? null;
}

export function listSessions(): SessionInfo[] {
  const rows = getDb()
    .prepare('SELECT * FROM sessions ORDER BY started_at DESC')
    .all() as SessionRecord[];
  return rows.map(toSessionInfo);
}

export function getSessionStatus(id: string): string | null {
  const row = getDb()
    .prepare('SELECT status FROM sessions WHERE session_id = ?')
    .get(id) as { status: string } | undefined;
  return row?.status ?? null;
}

export function getSessionHookState(id: string): SessionHookStateRow | null {
  return (getDb()
    .prepare(
      'SELECT status, attention_level, cwd, worktree, last_tool, model, claude_session_id, session_type, gemini_session_id, copilot_session_id FROM sessions WHERE session_id = ?',
    )
    .get(id) as SessionHookStateRow | undefined) ?? null;
}

export function getActiveAgentStates(): PollableSessionRow[] {
  return getDb()
    .prepare(
      `SELECT session_id, status, attention_level, last_tool, session_type FROM sessions
       WHERE status IN ('active', 'idle', 'waiting') AND session_type != 'terminal'`,
    )
    .all() as PollableSessionRow[];
}

export function getDetachedSessions(): Array<{ session_id: string; pre_detach_status: string | null }> {
  return getDb()
    .prepare(`SELECT session_id, pre_detach_status FROM sessions WHERE status = 'detached'`)
    .all() as Array<{ session_id: string; pre_detach_status: string | null }>;
}

export function countActiveSessions(): { agent: number; terminal: number } {
  const row = getDb()
    .prepare(
      `SELECT
        SUM(CASE WHEN session_type != 'terminal' THEN 1 ELSE 0 END) as agent,
        SUM(CASE WHEN session_type  = 'terminal' THEN 1 ELSE 0 END) as terminal
       FROM sessions
       WHERE status IN ('starting', 'active', 'idle', 'waiting')`,
    )
    .get() as { agent: number | null; terminal: number | null };
  return { agent: row.agent ?? 0, terminal: row.terminal ?? 0 };
}

export function hasActiveAgentSessions(): boolean {
  return !!getDb()
    .prepare(
      "SELECT 1 FROM sessions WHERE session_type != 'terminal' AND status IN ('starting', 'active', 'idle', 'waiting') LIMIT 1",
    )
    .get();
}

export function getLastClaudeDefaults(): SessionDefaults | null {
  const row = getDb()
    .prepare(
      `SELECT cwd, permission_mode, effort, enable_auto_mode, account_id FROM sessions
       WHERE session_type = 'claude'
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get() as { cwd: string; permission_mode: string | null; effort: string | null; enable_auto_mode: number | null; account_id: string | null } | undefined;
  if (!row) return null;
  return {
    cwd: row.cwd,
    permissionMode: (row.permission_mode as PermissionMode) ?? undefined,
    effort: (row.effort as EffortLevel) ?? undefined,
    enableAutoMode: row.enable_auto_mode === 1 ? true : row.enable_auto_mode === 0 ? false : undefined,
    accountId: row.account_id ?? undefined,
  };
}

export function lookupByClaudeSessionId(claudeSessionId: string): string | null {
  const row = getDb()
    .prepare('SELECT session_id FROM sessions WHERE claude_session_id = ?')
    .get(claudeSessionId) as { session_id: string } | undefined;
  return row?.session_id ?? null;
}

export function getDistinctCwds(sessionType: string): string[] {
  return (
    getDb()
      .prepare('SELECT DISTINCT cwd FROM sessions WHERE session_type = ?')
      .all(sessionType) as { cwd: string }[]
  ).map((r) => r.cwd);
}

export function findConflictingLabels(base: string): string[] {
  return (
    getDb()
      .prepare(`SELECT label FROM sessions WHERE label = ? OR label LIKE ? || ' (%)'`)
      .all(base, base) as { label: string }[]
  ).map((r) => r.label);
}

export function getTrackedClaudeSessionIds(): Set<string> {
  return new Set(
    (getDb()
      .prepare('SELECT claude_session_id FROM sessions WHERE claude_session_id IS NOT NULL')
      .all() as { claude_session_id: string }[])
      .map((r) => r.claude_session_id),
  );
}

export function getEndedSessionIds(): string[] {
  return (
    getDb()
      .prepare("SELECT session_id FROM sessions WHERE status = 'ended'")
      .all() as { session_id: string }[]
  ).map((r) => r.session_id);
}

export function getEmptyEndedSessionIds(): string[] {
  return (
    getDb()
      .prepare(
        "SELECT session_id FROM sessions WHERE status = 'ended' AND session_type = 'claude' AND claude_session_id IS NULL",
      )
      .all() as { session_id: string }[]
  ).map((r) => r.session_id);
}

export function getActiveTerminalSessionIds(): string[] {
  return (
    getDb()
      .prepare(
        `SELECT session_id FROM sessions WHERE session_type = 'terminal' AND status NOT IN ('ended', 'detached')`,
      )
      .all() as { session_id: string }[]
  ).map((r) => r.session_id);
}

export function hasPendingTasksForSession(id: string): boolean {
  return !!getDb()
    .prepare("SELECT 1 FROM task_queue WHERE target_session_id = ? AND status = 'pending' LIMIT 1")
    .get(id);
}

// ===================================================================
// WRITE functions (10)
// ===================================================================

export function insertSession(data: SessionInsertData): void {
  getDb().prepare(
    `INSERT INTO sessions (session_id, label, label_source, cwd, permission_mode, status, started_at, ended_at, command, hook_mode, session_type, terminal_config, effort, enable_auto_mode, allow_bypass_permissions, worktree, account_id, auto_close, model, claude_session_id)
     VALUES (?, ?, ?, ?, ?, 'starting', ?, NULL, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    data.sessionId,
    data.label,
    data.labelSource ?? 'auto',
    data.cwd,
    data.permissionMode ?? null,
    data.startedAt,
    data.command ?? null,
    data.hookMode,
    data.sessionType,
    data.effort ?? null,
    data.enableAutoMode ?? null,
    data.allowBypassPermissions ?? null,
    data.worktree ?? null,
    data.accountId ?? null,
    data.autoClose ?? 0,
    data.model ?? null,
    data.claudeSessionId ?? null,
  );
}

export function updateSession(id: string, fields: SessionUpdate): number {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const col = FIELD_TO_COLUMN[key];
    if (!col) continue;
    sets.push(`${col} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return 0;
  params.push(id);
  return getDb()
    .prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE session_id = ?`)
    .run(...params).changes;
}

export function updateAutoLabel(id: string, label: string): boolean {
  return getDb()
    .prepare(`UPDATE sessions SET label = ? WHERE session_id = ? AND label_source = 'auto'`)
    .run(label, id).changes > 0;
}

export function setAgentIdIfNull(
  id: string,
  column: 'codex_thread_id' | 'gemini_session_id' | 'copilot_session_id',
  value: string,
): boolean {
  return getDb()
    .prepare(`UPDATE sessions SET ${column} = ? WHERE session_id = ? AND ${column} IS NULL`)
    .run(value, id).changes > 0;
}

export function getClaimedAgentIds(
  column: 'codex_thread_id' | 'gemini_session_id' | 'copilot_session_id',
  excludeSessionId: string,
): Set<string> {
  return new Set(
    (getDb()
      .prepare(`SELECT ${column} FROM sessions WHERE ${column} IS NOT NULL AND session_id != ?`)
      .all(excludeSessionId) as Record<string, string>[])
      .map((r) => r[column]),
  );
}

export function deleteSessionWithEvents(id: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM events WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE session_id = ?').run(id);
  })();
}

export function deleteSessionsWithEvents(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const deleteEvents = db.prepare('DELETE FROM events WHERE session_id = ?');
  const deleteSession = db.prepare('DELETE FROM sessions WHERE session_id = ?');
  db.transaction(() => {
    for (const id of ids) {
      deleteEvents.run(id);
      deleteSession.run(id);
    }
  })();
}

export function markAllEnded(endedAt: string): void {
  getDb().prepare(
    `UPDATE sessions SET status = 'ended', ended_at = ?, attention_level = 'none', attention_reason = NULL WHERE status NOT IN ('ended', 'detached')`,
  ).run(endedAt);
}

export function markAllDetached(): void {
  getDb().prepare(
    `UPDATE sessions SET pre_detach_status = status, status = 'detached' WHERE status NOT IN ('ended', 'detached')`,
  ).run();
}

export function markTerminalSessionsEnded(): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT session_id FROM sessions WHERE session_type = 'terminal' AND status NOT IN ('ended', 'detached')`,
    )
    .all() as { session_id: string }[];
  if (rows.length === 0) return [];
  db.prepare(
    `UPDATE sessions SET status = 'ended' WHERE session_type = 'terminal' AND status NOT IN ('ended', 'detached')`,
  ).run();
  return rows.map((r) => r.session_id);
}

export function clearAllAttention(): string[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT session_id FROM sessions WHERE attention_level != 'none'`)
    .all() as { session_id: string }[];
  if (rows.length === 0) return [];
  db.prepare(
    `UPDATE sessions SET attention_level = 'none', attention_reason = NULL WHERE attention_level != 'none'`,
  ).run();
  return rows.map((r) => r.session_id);
}
