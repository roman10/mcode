import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { readdir, open as fsOpen } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { WebContents } from 'electron';
import type { IPtyManager } from '../shared/pty-manager-interface';
import type { AccountManager } from './account-manager';
import { getDb } from './db';
import { logger } from './logger';
import { stripAnsi } from '../shared/strip-ansi';
import { isAtClaudePrompt, isAtUserChoice } from './prompt-detect';
import {
  computeTransition,
  resolveAttention,
  USER_CHOICE_TOOLS,
} from './session-state-machine';
import type { HookEventName } from './session-state-machine';
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  HOOK_EVENT_RETENTION_DAYS,
  HOOK_TOOL_INPUT_MAX_BYTES,
  type EffortLevel,
  type PermissionMode,
} from '../shared/constants';
import type {
  SessionInfo,
  SessionType,
  SessionStatus,
  SessionAttentionLevel,
  SessionCreateInput,
  ExternalSessionInfo,
  HookEvent,
  HookRuntimeInfo,
  SessionDefaults,
  TerminalConfig,
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
  terminal_config: string;
  effort: string | null;
  ephemeral: number;
  worktree: string | null;
  account_id: string | null;
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
    effort: (row.effort as EffortLevel) ?? undefined,
    worktree: row.worktree,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    claudeSessionId: row.claude_session_id,
    lastTool: row.last_tool,
    lastEventAt: row.last_event_at,
    attentionLevel: row.attention_level as SessionAttentionLevel,
    attentionReason: row.attention_reason,
    hookMode: row.hook_mode as 'live' | 'fallback',
    sessionType: row.session_type as SessionType,
    terminalConfig: JSON.parse(row.terminal_config || '{}'),
    ephemeral: Boolean(row.ephemeral),
    accountId: row.account_id,
  };
}

function truncatePromptToLabel(prompt: string, maxLen: number): string {
  const firstLine = prompt.split('\n')[0].trim();
  if (!firstLine) return '';
  if (firstLine.length <= maxLen) return firstLine;
  const truncated = firstLine.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.3 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

/**
 * Extract the last `customTitle` from a Claude Code JSONL file.
 * Reads the tail of the file (up to 8KB) and scans backwards for a
 * `{"type":"custom-title","customTitle":"..."}` entry.
 *
 * 8KB is sufficient because Claude Code writes/updates customTitle entries
 * as the session progresses, so the latest one is near the end of the file.
 * Increase if titles are ever missed for very long conversations.
 */
async function extractCustomTitle(fh: FileHandle, fileSize: number, headChunk: string): Promise<string | undefined> {
  let searchChunk: string;
  if (fileSize <= 4096) {
    searchChunk = headChunk;
  } else {
    const tailSize = Math.min(8192, fileSize);
    const buf = Buffer.alloc(tailSize);
    await fh.read(buf, 0, tailSize, fileSize - tailSize);
    const raw = buf.toString('utf-8');
    // Discard first partial line (may be split mid-UTF-8 character)
    const firstNewline = raw.indexOf('\n');
    searchChunk = firstNewline >= 0 ? raw.slice(firstNewline + 1) : raw;
  }

  const lines = searchChunk.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('"custom-title"')) {
      try {
        const obj = JSON.parse(lines[i]) as { customTitle?: string };
        if (obj.customTitle) return obj.customTitle;
      } catch { /* skip malformed line */ }
    }
  }
  return undefined;
}

export type SessionUpdateListener = (
  session: SessionInfo,
  previousStatus: SessionStatus | null,
) => void;

export class SessionManager {
  private ptyManager: IPtyManager;
  private getWebContents: () => WebContents | null;
  private hookRuntimeGetter: () => HookRuntimeInfo;
  private accountManager: AccountManager;
  private sessionListeners = new Set<SessionUpdateListener>();

  constructor(
    ptyManager: IPtyManager,
    getWebContents: () => WebContents | null,
    hookRuntimeGetter: () => HookRuntimeInfo,
    accountManager: AccountManager,
  ) {
    this.ptyManager = ptyManager;
    this.getWebContents = getWebContents;
    this.hookRuntimeGetter = hookRuntimeGetter;
    this.accountManager = accountManager;
  }

  /** Subscribe to session updates in the main process (used by TaskQueue). */
  onSessionUpdated(listener: SessionUpdateListener): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  private notifyListeners(session: SessionInfo, previousStatus: SessionStatus | null): void {
    for (const listener of this.sessionListeners) {
      try {
        listener(session, previousStatus);
      } catch {
        // Listener errors must not break session state transitions
      }
    }
  }

  private nextDisambiguatedLabel(cwd: string): string {
    const base = basename(cwd);
    const db = getDb();
    const rows = db.prepare(
      `SELECT label FROM sessions WHERE label = ? OR label LIKE ? || ' (%)'`,
    ).all(base, base) as { label: string }[];
    if (rows.length === 0) return base;
    // Find highest counter in use
    let max = 1; // base without suffix counts as 1
    for (const { label } of rows) {
      if (label === base) continue;
      const match = label.match(/\((\d+)\)$/);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return `${base} (${max + 1})`;
  }

  create(input: SessionCreateInput, opts?: { initialCommand?: string }): SessionInfo {
    const sessionId = randomUUID();
    const cwd = input.cwd;
    const label = input.label
      || (input.initialPrompt ? truncatePromptToLabel(input.initialPrompt, 50) : null)
      || this.nextDisambiguatedLabel(cwd);
    const startedAt = new Date().toISOString();
    const sessionType = input.sessionType ?? 'claude';

    const isTerminal = sessionType === 'terminal';

    const command = isTerminal
      ? (input.command ?? process.env.SHELL ?? '/bin/zsh')
      : (input.command ?? 'claude');

    const isClaude = !isTerminal && isClaudeCommand(command);

    // Block Claude startup until the hook subsystem reaches a terminal runtime state.
    const hookRuntime = this.hookRuntimeGetter();
    if (isClaude && hookRuntime.state === 'initializing') {
      throw new Error('Hook system is still initializing. Retry session creation shortly.');
    }

    const hookMode = isClaude && hookRuntime.state === 'ready' ? 'live' : 'fallback';

    // Build args for CLI
    const args: string[] = [];
    if (isTerminal) {
      // For terminal sessions, pass through caller-provided args (e.g. ['-c', 'git push'])
      if (input.args) {
        args.push(...input.args);
      }
    } else {
      if (input.worktree !== undefined) {
        args.push('--worktree');
        if (input.worktree) {
          args.push(input.worktree);
        }
      }
      if (input.permissionMode) {
        args.push('--permission-mode', input.permissionMode);
      }
      if (input.effort) {
        args.push('--effort', input.effort);
      }
      if (input.initialPrompt) {
        args.push(input.initialPrompt);
      }
    }

    // Build account-specific environment overrides.
    // Applied for both Claude and terminal sessions so that auth terminals
    // (terminal sessions with accountId) also see the correct HOME.
    const accountEnv = this.accountManager.getSessionEnv(input.accountId);

    // Insert DB row FIRST so that onFirstData/onExit callbacks can UPDATE it.
    // If spawn fails, we delete the row.
    const db = getDb();
    const ephemeral = input.ephemeral ? 1 : 0;
    const worktree = isTerminal ? null : (input.worktree !== undefined ? (input.worktree || '') : null);
    const accountId = input.accountId ?? null;
    db.prepare(
      `INSERT INTO sessions (session_id, label, cwd, permission_mode, effort, status, started_at, hook_mode, session_type, ephemeral, worktree, account_id)
       VALUES (?, ?, ?, ?, ?, 'starting', ?, ?, ?, ?, ?, ?)`,
    ).run(sessionId, label, cwd, isTerminal ? null : (input.permissionMode ?? null), isTerminal ? null : (input.effort ?? null), startedAt, hookMode, sessionType, ephemeral, worktree, accountId);

    // Track account usage
    if (accountId) {
      this.accountManager.touchLastUsed(accountId);
    }

    try {
      this.ptyManager.spawn({
        id: sessionId,
        command,
        cwd,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        args: args.length > 0 ? args : undefined,
        env: { MCODE_SESSION_ID: sessionId, ...accountEnv },
        onFirstData: () => {
          // PTY data drives starting -> active/idle in all modes.
          // In live mode, SessionStart hook may arrive first — updateStatus
          // idempotency guard makes this a safe no-op in that case.
          if (opts?.initialCommand) {
            // Session has pre-loaded work — mark active so the task queue
            // won't dispatch to it before the initial command is processed.
            this.updateStatus(sessionId, 'active');
            this.ptyManager.write(sessionId, opts.initialCommand + '\n');
          } else if (sessionType === 'claude') {
            // Claude session with no initial command — it's at the prompt
            // waiting for user input, so idle is the accurate state.
            this.updateStatus(sessionId, 'idle');
          } else {
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

    // Safety net: if still starting after 15s, force-transition
    setTimeout(() => {
      const s = this.get(sessionId);
      if (s && s.status === 'starting') {
        const targetStatus = sessionType === 'claude' && !opts?.initialCommand ? 'idle' : 'active';
        logger.warn('session', 'Starting timeout, forcing status', { sessionId, targetStatus });
        this.updateStatus(sessionId, targetStatus);
      }
    }, 15_000);

    logger.info('session', 'Created session', { sessionId, cwd, label, hookMode });

    const session = this.get(sessionId)!;
    return session;
  }

  /** Resume an ended Claude session via `claude --resume`. */
  resume(sessionId: string, accountId?: string): SessionInfo {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM sessions WHERE session_id = ?')
      .get(sessionId) as SessionRecord | undefined;

    if (!row) throw new Error(`Session not found: ${sessionId}`);
    if (row.status !== 'ended') throw new Error(`Session is not ended (status: ${row.status})`);
    if (!row.claude_session_id) throw new Error('Cannot resume: no Claude session ID recorded');

    // Determine effective cwd (worktree sessions run inside the worktree directory)
    let effectiveCwd = row.cwd;
    if (row.worktree) {
      effectiveCwd = join(row.cwd, '.claude', 'worktrees', row.worktree);
      if (!existsSync(effectiveCwd)) {
        throw new Error(`Worktree directory no longer exists: ${effectiveCwd}`);
      }
    } else if (row.worktree === '') {
      throw new Error('Cannot resume: worktree name was never captured.');
    }

    const hookRuntime = this.hookRuntimeGetter();
    const hookMode = hookRuntime.state === 'ready' ? 'live' : 'fallback';

    // Reset session to starting state
    db.prepare(
      `UPDATE sessions SET status = 'starting', ended_at = NULL, hook_mode = ? WHERE session_id = ?`,
    ).run(hookMode, sessionId);

    // Build args: claude --resume <claude_session_id>
    const args: string[] = ['--resume', row.claude_session_id];
    if (row.permission_mode) {
      args.push('--permission-mode', row.permission_mode);
    }
    if (row.effort) {
      args.push('--effort', row.effort);
    }

    // Use account override if provided, otherwise fall back to the session's stored account
    const effectiveAccountId = accountId ?? row.account_id ?? undefined;
    if (accountId && accountId !== row.account_id) {
      db.prepare('UPDATE sessions SET account_id = ? WHERE session_id = ?').run(accountId, sessionId);
    }
    const accountEnv = this.accountManager.getSessionEnv(effectiveAccountId);

    try {
      this.ptyManager.spawn({
        id: sessionId,
        command: 'claude',
        cwd: effectiveCwd,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        args,
        env: { MCODE_SESSION_ID: sessionId, ...accountEnv },
        onFirstData: () => {
          // Resumed session waits for user input — idle is accurate.
          this.updateStatus(sessionId, 'idle');
        },
        onExit: () => {
          this.updateStatus(sessionId, 'ended');
        },
      });
    } catch (err) {
      // Spawn failed — revert to ended
      db.prepare(
        `UPDATE sessions SET status = 'ended', ended_at = ? WHERE session_id = ?`,
      ).run(new Date().toISOString(), sessionId);
      throw err;
    }

    // Safety net: if still starting after 15s, force-transition to idle
    setTimeout(() => {
      const s = this.get(sessionId);
      if (s && s.status === 'starting') {
        logger.warn('session', 'Starting timeout, forcing idle', { sessionId });
        this.updateStatus(sessionId, 'idle');
      }
    }, 15_000);

    logger.info('session', 'Resumed session', { sessionId, claudeSessionId: row.claude_session_id, cwd: effectiveCwd, worktree: row.worktree });

    const session = this.get(sessionId)!;
    this.broadcastSessionUpdate(sessionId);
    return session;
  }

  /** Import and resume an external Claude Code session not tracked by mcode. */
  importExternal(claudeSessionId: string, cwd: string, providedLabel?: string): SessionInfo {
    const sessionId = randomUUID();
    const label = providedLabel || `Imported: ${claudeSessionId.slice(0, 8)}`;
    const startedAt = new Date().toISOString();

    const hookRuntime = this.hookRuntimeGetter();
    const hookMode = hookRuntime.state === 'ready' ? 'live' : 'fallback';

    const db = getDb();
    db.prepare(
      `INSERT INTO sessions (session_id, label, cwd, permission_mode, status, started_at, claude_session_id, hook_mode, session_type)
       VALUES (?, ?, ?, NULL, 'starting', ?, ?, ?, 'claude')`,
    ).run(sessionId, label, cwd, startedAt, claudeSessionId, hookMode);

    const args = ['--resume', claudeSessionId];

    try {
      this.ptyManager.spawn({
        id: sessionId,
        command: 'claude',
        cwd,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        args,
        env: { MCODE_SESSION_ID: sessionId },
        onFirstData: () => {
          // Imported session waits for user input — idle is accurate.
          this.updateStatus(sessionId, 'idle');
        },
        onExit: () => {
          this.updateStatus(sessionId, 'ended');
        },
      });
    } catch (err) {
      db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
      throw err;
    }

    // Safety net: if still starting after 15s, force-transition to idle
    setTimeout(() => {
      const s = this.get(sessionId);
      if (s && s.status === 'starting') {
        logger.warn('session', 'Starting timeout, forcing idle', { sessionId });
        this.updateStatus(sessionId, 'idle');
      }
    }, 15_000);

    logger.info('session', 'Imported external session', { sessionId, claudeSessionId, cwd });

    const session = this.get(sessionId)!;
    // Broadcast as a new session creation
    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('session:created', session);
    }
    return session;
  }

  /** Scan ~/.claude/projects/ for Claude Code sessions not tracked by mcode. */
  async listExternalSessions(cwd: string, limit = 50): Promise<ExternalSessionInfo[]> {
    // Encode cwd to Claude Code's directory naming: /Users/foo/bar → -Users-foo-bar
    const encoded = cwd.replace(/\//g, '-');
    const projectDir = join(homedir(), '.claude', 'projects', encoded);

    let files: string[];
    try {
      files = (await readdir(projectDir)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      return []; // Directory doesn't exist
    }

    // Get all claude_session_ids already tracked by mcode
    const db = getDb();
    const tracked = new Set(
      (db.prepare('SELECT claude_session_id FROM sessions WHERE claude_session_id IS NOT NULL').all() as { claude_session_id: string }[])
        .map((r) => r.claude_session_id),
    );

    const results: ExternalSessionInfo[] = [];
    for (const file of files) {
      const claudeSessionId = file.replace('.jsonl', '');
      if (tracked.has(claudeSessionId)) continue;

      // Read first line (up to 4KB) for slug/timestamp, then tail for customTitle
      let fh: FileHandle | undefined;
      try {
        const filePath = join(projectDir, file);
        fh = await fsOpen(filePath, 'r');
        const buf = Buffer.alloc(4096);
        const { bytesRead } = await fh.read(buf, 0, 4096, 0);
        const chunk = buf.toString('utf-8', 0, bytesRead);
        const newlineIdx = chunk.indexOf('\n');
        const firstLine = newlineIdx > 0 ? chunk.slice(0, newlineIdx) : chunk;
        const parsed = JSON.parse(firstLine) as { timestamp?: string; slug?: string };
        const stat = await fh.stat();
        const customTitle = await extractCustomTitle(fh, stat.size, chunk);
        results.push({
          claudeSessionId,
          startedAt: parsed.timestamp ?? '',
          slug: parsed.slug ?? claudeSessionId.slice(0, 8),
          customTitle,
        });
      } catch {
        // Malformed file or read error, skip
      } finally {
        if (fh) await fh.close();
      }
    }

    // Sort newest first, apply limit
    results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return results.slice(0, limit);
  }

  updateStatus(sessionId: string, status: SessionStatus): void {
    const db = getDb();

    // Idempotency guard — skip if already in target state
    const current = db
      .prepare('SELECT status FROM sessions WHERE session_id = ?')
      .get(sessionId) as { status: string } | undefined;
    if (!current || current.status === status) return;
    // Don't transition away from ended or detached→ended (both terminal-ish, but detached can recover)
    if (current.status === 'ended') return;

    const previousStatus = current.status as SessionStatus;

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

    const session = this.get(sessionId);
    if (session) this.notifyListeners(session, previousStatus);

    // Auto-delete ephemeral sessions after they end, with a short delay
    // so MCP callers using session_wait_for_status can read the final status.
    if (status === 'ended' && session?.ephemeral) {
      setTimeout(() => {
        try {
          this.delete(sessionId);
        } catch {
          // Session may already be deleted
        }
      }, 2000);
    }

    // Auto-delete ended Claude sessions with no Claude session ID (no interaction occurred).
    if (status === 'ended' && session && !session.ephemeral
        && session.sessionType === 'claude' && !session.claudeSessionId) {
      setTimeout(() => {
        try {
          this.delete(sessionId);
        } catch {
          // Session may already be deleted
        }
      }, 500);
    }
  }

  /** Handle a hook event from the hook server or injected via MCP. */
  handleHookEvent(sessionId: string, event: HookEvent): boolean {
    const db = getDb();

    // Verify session exists
    let row = db
      .prepare('SELECT status, attention_level, cwd, worktree, last_tool FROM sessions WHERE session_id = ?')
      .get(sessionId) as { status: string; attention_level: string; cwd: string; worktree: string | null; last_tool: string | null } | undefined;
    if (!row) {
      logger.warn('session', 'Hook event for unknown session', { sessionId, event: event.hookEventName });
      return false;
    }

    // Don't process events for ended sessions
    if (row.status === 'ended') return true;

    // Persist claude_session_id if present
    if (event.claudeSessionId) {
      db.prepare(
        'UPDATE sessions SET claude_session_id = ? WHERE session_id = ?',
      ).run(event.claudeSessionId, sessionId);
    }

    // Capture auto-generated worktree name from hook event cwd
    if (row.worktree === '' && typeof event.payload.cwd === 'string') {
      const worktreePrefix = join(row.cwd, '.claude', 'worktrees') + '/';
      if (event.payload.cwd.startsWith(worktreePrefix)) {
        const rest = event.payload.cwd.slice(worktreePrefix.length);
        const name = rest.split('/')[0];
        if (name) {
          db.prepare('UPDATE sessions SET worktree = ? WHERE session_id = ?')
            .run(name, sessionId);
          row = { ...row, worktree: name };
        }
      }
    }

    // Compute state transition (pure)
    const currentStatus = row.status as SessionStatus;
    const currentAttention = row.attention_level as SessionAttentionLevel;

    const result = computeTransition(event.hookEventName as HookEventName, {
      currentStatus,
      lastTool: row.last_tool,
      toolName: event.toolName,
    });
    if (!result) return true;

    if (result.selfHealed) {
      logger.info('session', 'Self-healed starting→active on event', {
        sessionId, event: event.hookEventName,
      });
    }

    // Resolve attention (may need DB query for pending tasks)
    const hasPendingTasks = result.attention.type === 'set-action-if-active-no-pending'
      ? !!db.prepare("SELECT 1 FROM task_queue WHERE target_session_id = ? AND status = 'pending' LIMIT 1").get(sessionId)
      : false;
    const { level: newAttention, reason: attentionReason } = resolveAttention(
      result.attention,
      currentAttention,
      { hasPendingTasks },
    );
    const newStatus = result.status;

    // Persist event with computed status
    this.persistEvent(sessionId, event, newStatus);

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
    } else if (attentionReason !== null) {
      updates.push('attention_reason = ?');
      params.push(attentionReason);
    }

    if (result.lastTool.type === 'set') {
      updates.push('last_tool = ?');
      params.push(result.lastTool.toolName);
    } else if (result.lastTool.type === 'clear') {
      updates.push('last_tool = NULL');
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
    this.broadcastHookEvent({ ...event, sessionStatus: newStatus });

    if (newStatus !== currentStatus) {
      const session = this.get(sessionId);
      if (session) this.notifyListeners(session, currentStatus);
    }

    return true;
  }

  private persistEvent(sessionId: string, event: HookEvent, sessionStatus: SessionStatus): void {
    const db = getDb();
    const toolInput = serializeToolInput(event.toolInput);

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

  delete(sessionId: string): void {
    const db = getDb();
    const row = db
      .prepare('SELECT status FROM sessions WHERE session_id = ?')
      .get(sessionId) as { status: string } | undefined;

    if (!row) throw new Error(`Session not found: ${sessionId}`);
    if (row.status !== 'ended') throw new Error(`Session is not ended (status: ${row.status}). Kill it first.`);

    db.transaction(() => {
      db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
    })();

    logger.info('session', 'Deleted session', { sessionId });

    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('session:deleted', sessionId);
    }
  }

  deleteAllEnded(): string[] {
    const db = getDb();
    const rows = db
      .prepare("SELECT session_id FROM sessions WHERE status = 'ended'")
      .all() as { session_id: string }[];
    const ids = rows.map((r) => r.session_id);
    if (ids.length === 0) return [];

    const deleteEvents = db.prepare('DELETE FROM events WHERE session_id = ?');
    const deleteSession = db.prepare('DELETE FROM sessions WHERE session_id = ?');
    db.transaction(() => {
      for (const id of ids) {
        deleteEvents.run(id);
        deleteSession.run(id);
      }
    })();

    logger.info('session', 'Deleted all ended sessions', { count: ids.length });

    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('session:deleted-batch', ids);
    }
    return ids;
  }

  /** Delete all ended Claude sessions that never received a claude_session_id. */
  deleteEmptyEnded(): number {
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT session_id FROM sessions WHERE status = 'ended' AND session_type = 'claude' AND claude_session_id IS NULL",
      )
      .all() as { session_id: string }[];
    if (rows.length === 0) return 0;

    const ids = rows.map((r) => r.session_id);
    const deleteEvents = db.prepare('DELETE FROM events WHERE session_id = ?');
    const deleteSession = db.prepare('DELETE FROM sessions WHERE session_id = ?');
    db.transaction(() => {
      for (const id of ids) {
        deleteEvents.run(id);
        deleteSession.run(id);
      }
    })();

    logger.info('session', 'Deleted empty Claude sessions', { count: ids.length });

    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('session:deleted-batch', ids);
    }
    return ids.length;
  }

  deleteBatch(sessionIds: string[]): string[] {
    const db = getDb();
    const validIds: string[] = [];

    for (const id of sessionIds) {
      const row = db
        .prepare('SELECT status FROM sessions WHERE session_id = ?')
        .get(id) as { status: string } | undefined;
      if (row && row.status === 'ended') {
        validIds.push(id);
      }
    }

    if (validIds.length === 0) return [];

    const deleteEvents = db.prepare('DELETE FROM events WHERE session_id = ?');
    const deleteSession = db.prepare('DELETE FROM sessions WHERE session_id = ?');
    db.transaction(() => {
      for (const id of validIds) {
        deleteEvents.run(id);
        deleteSession.run(id);
      }
    })();

    logger.info('session', 'Deleted batch of sessions', { count: validIds.length });

    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('session:deleted-batch', validIds);
    }
    return validIds;
  }

  async kill(sessionId: string): Promise<void> {
    // Mark ended BEFORE killing PTY so the handleHookEvent guard
    // (status='ended' → skip) prevents any late hook events from processing.
    this.updateStatus(sessionId, 'ended');
    this.clearAttention(sessionId);
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

  list(opts?: { includeEphemeral?: boolean }): SessionInfo[] {
    const db = getDb();
    const query = opts?.includeEphemeral
      ? 'SELECT * FROM sessions ORDER BY started_at DESC'
      : 'SELECT * FROM sessions WHERE ephemeral = 0 ORDER BY started_at DESC';
    const rows = db.prepare(query).all() as SessionRecord[];
    return rows.map(toSessionInfo);
  }

  /** Return distinct cwds from Claude sessions (lightweight alternative to list()). */
  getDistinctClaudeCwds(): string[] {
    const db = getDb();
    return (
      db.prepare('SELECT DISTINCT cwd FROM sessions WHERE session_type = ?').all('claude') as { cwd: string }[]
    ).map((r) => r.cwd);
  }

  /** Check if any session is in an active-like state (avoids full table deserialization). */
  hasActiveSessions(): boolean {
    const db = getDb();
    return !!db
      .prepare("SELECT 1 FROM sessions WHERE status IN ('starting', 'active', 'idle', 'waiting') LIMIT 1")
      .get();
  }

  /** Count sessions in an active-like state. */
  activeSessionCount(): number {
    const db = getDb();
    const row = db
      .prepare("SELECT COUNT(*) as count FROM sessions WHERE status IN ('starting', 'active', 'idle', 'waiting')")
      .get() as { count: number };
    return row.count;
  }

  getLastDefaults(): SessionDefaults | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT cwd, permission_mode, effort, account_id FROM sessions
         WHERE session_type = 'claude' AND ephemeral = 0
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get() as { cwd: string; permission_mode: string | null; effort: string | null; account_id: string | null } | undefined;
    if (!row) return null;
    return {
      cwd: row.cwd,
      permissionMode: (row.permission_mode as PermissionMode) ?? undefined,
      effort: (row.effort as EffortLevel) ?? undefined,
      accountId: row.account_id ?? undefined,
    };
  }

  setLabel(sessionId: string, label: string): void {
    const db = getDb();
    db.prepare('UPDATE sessions SET label = ?, label_source = ? WHERE session_id = ?').run(
      label,
      'user',
      sessionId,
    );
    this.broadcastSessionUpdate(sessionId);
  }

  /**
   * Update label only if it was not manually renamed by the user.
   * Used for auto-generated titles (e.g. terminal OSC title from Claude Code).
   */
  setAutoLabel(sessionId: string, label: string): void {
    const db = getDb();
    const result = db.prepare(
      `UPDATE sessions SET label = ? WHERE session_id = ? AND label_source = 'auto'`,
    ).run(label, sessionId);
    if (result.changes > 0) {
      this.broadcastSessionUpdate(sessionId);
    }
  }

  setTerminalConfig(sessionId: string, partial: Partial<TerminalConfig>): void {
    const db = getDb();
    const row = db
      .prepare('SELECT terminal_config FROM sessions WHERE session_id = ?')
      .get(sessionId) as { terminal_config: string } | undefined;
    const existing: TerminalConfig = JSON.parse(row?.terminal_config || '{}');
    const merged = { ...existing, ...partial };
    db.prepare('UPDATE sessions SET terminal_config = ? WHERE session_id = ?').run(
      JSON.stringify(merged),
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

  /** Atomically set status + attention in one DB update. */
  updateStatusWithAttention(
    sessionId: string,
    status: SessionStatus,
    attention: SessionAttentionLevel,
    reason: string | null,
  ): void {
    const db = getDb();
    const current = db
      .prepare('SELECT status FROM sessions WHERE session_id = ?')
      .get(sessionId) as { status: string } | undefined;
    if (!current || current.status === status || current.status === 'ended') return;

    const previousStatus = current.status as SessionStatus;

    if (status === 'ended') {
      db.prepare(
        `UPDATE sessions SET status = ?, ended_at = ?, attention_level = ?, attention_reason = ? WHERE session_id = ?`,
      ).run(status, new Date().toISOString(), attention, reason, sessionId);
    } else {
      db.prepare(
        `UPDATE sessions SET status = ?, attention_level = ?, attention_reason = ? WHERE session_id = ?`,
      ).run(status, attention, reason, sessionId);
    }

    logger.info('session', 'Status+attention changed', { sessionId, status, attention });
    this.broadcastSessionUpdate(sessionId);

    const session = this.get(sessionId);
    if (session) this.notifyListeners(session, previousStatus);
  }

  // --- PTY-based state detection ---

  private static readonly PERMISSION_PATTERNS = [
    /Allow\s+once/,
    /Deny\s+once/,
    /Allow\s+always/,
  ];

  private static readonly PTY_QUIESCENCE_MS = 5000;

  /** Poll active sessions for permission prompts, idle prompts, and user-choice menus. */
  pollSessionStates(): void {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT session_id, status, attention_level, last_tool FROM sessions
         WHERE status IN ('active', 'idle', 'waiting') AND session_type = 'claude'`,
      )
      .all() as { session_id: string; status: string; attention_level: string; last_tool: string | null }[];

    const now = Date.now();

    for (const row of rows) {
      const buffer = this.ptyManager.getReplayData(row.session_id);
      if (!buffer) continue;

      const lastDataAt = this.ptyManager.getLastDataAt(row.session_id);
      const tail = stripAnsi(buffer.slice(-2000));
      const rawTail = buffer.slice(-2000);
      const hasPermissionPrompt = SessionManager.PERMISSION_PATTERNS.some((re) => re.test(tail));
      const isQuiescent = lastDataAt > 0 && now - lastDataAt > SessionManager.PTY_QUIESCENCE_MS;

      if (
        (row.status === 'active' || row.status === 'idle') &&
        row.attention_level !== 'action' &&
        hasPermissionPrompt &&
        isQuiescent
      ) {
        // Permission prompt detected: quiescent + pattern visible
        this.updateStatusWithAttention(row.session_id, 'waiting', 'action', 'Permission prompt detected');
      } else if (
        (row.status === 'active' || row.status === 'idle') &&
        row.attention_level !== 'action' &&
        isAtUserChoice(rawTail) &&
        (isQuiescent || (row.last_tool != null && USER_CHOICE_TOOLS.has(row.last_tool)))
      ) {
        // User-choice menu detected (plan mode, AskUserQuestion, etc.)
        // When last_tool confirms a user-choice tool, skip quiescence to avoid
        // status bar updates blocking detection indefinitely.
        this.updateStatusWithAttention(row.session_id, 'waiting', 'action', 'Waiting for your response');
      } else if (
        (row.status === 'active' || row.status === 'waiting') &&
        isQuiescent &&
        isAtClaudePrompt(rawTail) &&
        !isAtUserChoice(rawTail)
      ) {
        // Idle prompt detected: Claude is waiting at ❯ for new input
        // Guard against user-choice menus whose ❯ cursor also satisfies isAtClaudePrompt.
        const hasPending = db
          .prepare("SELECT 1 FROM task_queue WHERE target_session_id = ? AND status = 'pending' LIMIT 1")
          .get(row.session_id);
        if (hasPending) {
          this.updateStatus(row.session_id, 'idle');
        } else {
          this.updateStatusWithAttention(row.session_id, 'idle', 'action', 'Claude finished — awaiting next input');
        }
      }
      // Note: no explicit waiting → active recovery here. When the user
      // answers a permission prompt, PreToolUse/PostToolUse hooks handle
      // the transition. The idle-prompt branch above also covers 'waiting'
      // as a fallback if hooks fail and Claude reaches the ❯ prompt.
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
        session_status: string | null;
      }>;

    return rows.map((r) => ({
      sessionId: r.session_id,
      claudeSessionId: r.claude_session_id,
      hookEventName: r.hook_event_name,
      toolName: r.tool_name,
      toolInput: tryParseJson<Record<string, unknown>>(r.tool_input),
      createdAt: r.created_at,
      payload: tryParseJson<Record<string, unknown>>(r.payload) ?? {},
      sessionStatus: (r.session_status as SessionStatus) ?? undefined,
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
      `UPDATE sessions SET status = 'ended', ended_at = ?, attention_level = 'none', attention_reason = NULL WHERE status NOT IN ('ended', 'detached')`,
    ).run(now);
    logger.info('session', 'Marked all active sessions as ended');
  }

  /** Mark all running sessions as detached (PTY broker is keeping them alive). Called on normal quit. */
  detachAllActive(): void {
    const db = getDb();
    db.prepare(
      `UPDATE sessions SET pre_detach_status = status, status = 'detached' WHERE status NOT IN ('ended', 'detached')`,
    ).run();
    logger.info('session', 'Marked all active sessions as detached');
  }

  /**
   * Reconcile detached sessions against what the PTY broker reports as alive.
   * Called on app open after connecting to the broker.
   */
  reconcileDetachedSessions(aliveSessionIds: string[]): void {
    const db = getDb();
    const aliveSet = new Set(aliveSessionIds);

    const detached = db
      .prepare(`SELECT session_id, pre_detach_status FROM sessions WHERE status = 'detached'`)
      .all() as Array<{ session_id: string; pre_detach_status: string | null }>;

    for (const { session_id, pre_detach_status } of detached) {
      if (aliveSet.has(session_id)) {
        const restoreStatus = (pre_detach_status || 'active') as SessionStatus;
        this.updateStatus(session_id, restoreStatus);
        db.prepare('UPDATE sessions SET pre_detach_status = NULL WHERE session_id = ?').run(session_id);
        logger.info('session', 'Reconnected to running session', { sessionId: session_id, restoredStatus: restoreStatus });
      } else {
        this.updateStatus(session_id, 'ended');
        db.prepare('UPDATE sessions SET pre_detach_status = NULL WHERE session_id = ?').run(session_id);
        logger.info('session', 'Detached session no longer running', { sessionId: session_id });
      }
    }
  }

  // --- Layout persistence ---

  saveLayout(mosaicTree: unknown, sidebarWidth?: number, sidebarCollapsed?: boolean, activeSidebarTab?: string): void {
    const db = getDb();
    if (mosaicTree === null || mosaicTree === undefined) {
      db.prepare('DELETE FROM layout_state WHERE id = 1').run();
      return;
    }
    const json = JSON.stringify(mosaicTree);
    const width = sidebarWidth ?? 280;
    const collapsed = sidebarCollapsed ? 1 : 0;
    const tab = activeSidebarTab ?? 'sessions';
    db.prepare(
      `INSERT INTO layout_state (id, mosaic_tree, sidebar_width, sidebar_collapsed, active_sidebar_tab, updated_at)
       VALUES (1, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET mosaic_tree = ?, sidebar_width = ?, sidebar_collapsed = ?, active_sidebar_tab = ?, updated_at = datetime('now')`,
    ).run(json, width, collapsed, tab, json, width, collapsed, tab);
  }

  loadLayout(): { mosaicTree: unknown; sidebarWidth: number; sidebarCollapsed: boolean; activeSidebarTab: string } | null {
    const db = getDb();
    const row = db
      .prepare('SELECT mosaic_tree, sidebar_width, sidebar_collapsed, active_sidebar_tab FROM layout_state WHERE id = 1')
      .get() as { mosaic_tree: string; sidebar_width: number; sidebar_collapsed: number; active_sidebar_tab: string | null } | undefined;
    if (!row) return null;
    try {
      return {
        mosaicTree: JSON.parse(row.mosaic_tree),
        sidebarWidth: row.sidebar_width,
        sidebarCollapsed: Boolean(row.sidebar_collapsed),
        activeSidebarTab: row.active_sidebar_tab ?? 'sessions',
      };
    } catch {
      return null;
    }
  }

  /** Get recent events across all sessions. */
  getRecentAllEvents(limit = 200): HookEvent[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM events ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as Array<{
        session_id: string;
        claude_session_id: string | null;
        hook_event_name: string;
        tool_name: string | null;
        tool_input: string | null;
        payload: string;
        created_at: string;
        session_status: string | null;
      }>;

    return rows.map((r) => ({
      sessionId: r.session_id,
      claudeSessionId: r.claude_session_id,
      hookEventName: r.hook_event_name,
      toolName: r.tool_name,
      toolInput: tryParseJson<Record<string, unknown>>(r.tool_input),
      createdAt: r.created_at,
      payload: tryParseJson<Record<string, unknown>>(r.payload) ?? {},
      sessionStatus: (r.session_status as SessionStatus) ?? undefined,
    }));
  }

  /** Delete all hook events from the database. */
  clearAllEvents(): void {
    const db = getDb();
    db.prepare('DELETE FROM events').run();
  }
}
