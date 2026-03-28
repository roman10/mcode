import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { readdir, open as fsOpen } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { WebContents } from 'electron';
import type { IPtyManager } from '../../shared/pty-manager-interface';
import type { AccountManager } from '../account-manager';
import { getDb } from '../db';
import { logger } from '../logger';
import { stripAnsi } from '../../shared/strip-ansi';
import { extractLatestModel } from '../trackers/jsonl-usage-parser';
import { normalizeModelVersion } from '../trackers/token-cost';
import { isAgentSession } from '../../shared/session-agents';
import { getTranscriptPath } from './transcript-path';
import { findCodexThreadMatch } from './codex-session-store';
import { isAtClaudePrompt, isAtUserChoice } from './prompt-detect';
import {
  parseGeminiSessionList,
  resolveGeminiResumeIndex,
  selectGeminiSessionCandidate,
} from './gemini-session-store';
import {
  buildCreateSessionArgs,
  buildSessionLabel,
  getDefaultSessionCommand,
  resolveCreateHookMode,
} from './session-launch';
import {
  computeTransition,
  resolveAttention,
  USER_CHOICE_TOOLS,
} from './session-state-machine';
import type { HookEventName } from './session-state-machine';
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  HOOK_TOOL_INPUT_MAX_BYTES,
  type EffortLevel,
  type PermissionMode,
} from '../../shared/constants';
import { SessionEventStore } from './session-event-store';
import { LayoutRepository } from './layout-repository';
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
} from '../../shared/types';
import { typedHandle } from '../ipc-helpers';

interface SessionRecord {
  session_id: string;
  label: string;
  cwd: string;
  permission_mode: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  command: string | null;
  claude_session_id: string | null;
  codex_thread_id: string | null;
  gemini_session_id: string | null;
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
}

function isClaudeCommand(command: string): boolean {
  const normalized = basename(command).toLowerCase();
  return normalized === 'claude' || normalized === 'claude.exe' || normalized === 'claude.cmd';
}

function isCodexCommand(command: string): boolean {
  const normalized = basename(command).toLowerCase();
  return normalized === 'codex' || normalized === 'codex.exe';
}

function toSessionInfo(row: SessionRecord): SessionInfo {
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
  private eventStore: SessionEventStore;
  readonly layoutRepo: LayoutRepository;

  /** Set to true after Codex hook bridge is successfully configured at startup. */
  codexHookBridgeReady = false;

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
    this.eventStore = new SessionEventStore(HOOK_TOOL_INPUT_MAX_BYTES);
    this.layoutRepo = new LayoutRepository();
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

  private scheduleCodexThreadCapture(
    sessionId: string,
    cwd: string,
    startedAt: string,
    initialPrompt?: string,
  ): void {
    const startedAtMs = Date.parse(startedAt);
    if (!Number.isFinite(startedAtMs)) return;

    const deadline = Date.now() + 15_000;
    const poll = async (): Promise<void> => {
      const db = getDb();
      const row = db.prepare(
        'SELECT session_type, codex_thread_id FROM sessions WHERE session_id = ?',
      ).get(sessionId) as { session_type: string; codex_thread_id: string | null } | undefined;
      if (!row || row.session_type !== 'codex' || row.codex_thread_id) return;

      const claimedThreadIds = new Set(
        (
          db.prepare(
            'SELECT codex_thread_id FROM sessions WHERE codex_thread_id IS NOT NULL AND session_id != ?',
          ).all(sessionId) as { codex_thread_id: string }[]
        ).map((entry) => entry.codex_thread_id),
      );

      const match = findCodexThreadMatch({
        cwd,
        initialPrompt,
        startedAtMs,
        nowMs: Date.now(),
        claimedThreadIds,
      });
      if (match) {
        const result = db.prepare(
          'UPDATE sessions SET codex_thread_id = ? WHERE session_id = ? AND codex_thread_id IS NULL',
        ).run(match.id, sessionId);
        if (result.changes > 0) {
          logger.info('session', 'Captured Codex thread ID', { sessionId, codexThreadId: match.id });
          this.broadcastSessionUpdate(sessionId);
        }
        return;
      }

      if (Date.now() >= deadline) {
        logger.warn('session', 'Failed to capture Codex thread ID', { sessionId, cwd });
        return;
      }

      setTimeout(() => {
        poll().catch(() => { });
      }, 500);
    };

    poll().catch(() => { });
  }

  private listGeminiSessions(command: string, cwd: string): ReturnType<typeof parseGeminiSessionList> {
    const output = execFileSync(command, ['--list-sessions'], {
      cwd,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return parseGeminiSessionList(output);
  }

  private scheduleGeminiSessionCapture(
    sessionId: string,
    cwd: string,
    command: string,
    initialPrompt?: string,
  ): void {
    const deadline = Date.now() + 15_000;
    const poll = async (): Promise<void> => {
      const db = getDb();
      const row = db.prepare(
        'SELECT session_type, gemini_session_id FROM sessions WHERE session_id = ?',
      ).get(sessionId) as { session_type: string; gemini_session_id: string | null } | undefined;
      if (!row || row.session_type !== 'gemini' || row.gemini_session_id) return;

      try {
        const claimedSessionIds = new Set(
          (
            db.prepare(
              'SELECT gemini_session_id FROM sessions WHERE gemini_session_id IS NOT NULL AND session_id != ?',
            ).all(sessionId) as { gemini_session_id: string }[]
          ).map((entry) => entry.gemini_session_id),
        );

        const entries = this.listGeminiSessions(command, cwd);
        const match = selectGeminiSessionCandidate(entries, {
          initialPrompt,
          claimedSessionIds,
        });

        if (match) {
          const result = db.prepare(
            'UPDATE sessions SET gemini_session_id = ? WHERE session_id = ? AND gemini_session_id IS NULL',
          ).run(match.geminiSessionId, sessionId);
          if (result.changes > 0) {
            logger.info('session', 'Captured Gemini session ID', {
              sessionId,
              geminiSessionId: match.geminiSessionId,
            });
            this.broadcastSessionUpdate(sessionId);
          }
          return;
        }
      } catch {
        // Gemini may not list the new session immediately; keep polling until deadline.
      }

      if (Date.now() >= deadline) {
        logger.warn('session', 'Failed to capture Gemini session ID', { sessionId, cwd });
        return;
      }

      setTimeout(() => {
        poll().catch(() => { });
      }, 500);
    };

    poll().catch(() => { });
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

  create(input: SessionCreateInput): SessionInfo {
    const sessionId = randomUUID();
    const cwd = input.cwd;
    const sessionType = input.sessionType ?? 'claude';
    const isTerminal = sessionType === 'terminal';
    const { label, labelSource } = buildSessionLabel({
      sessionType,
      userLabel: input.label || null,
      initialPrompt: input.initialPrompt,
      nextDisambiguatedLabel: () => this.nextDisambiguatedLabel(cwd),
    });
    const startedAt = new Date().toISOString();

    const command = input.command ?? getDefaultSessionCommand(sessionType, process.env.SHELL ?? '/bin/zsh');

    const isClaude = sessionType === 'claude';
    const isCodex = sessionType === 'codex';
    const isGemini = sessionType === 'gemini';
    const supportsClaudeHooks = isClaude && isClaudeCommand(command);
    const supportsCodexHooks = isCodex && isCodexCommand(command);

    // Block Claude startup until the hook subsystem reaches a terminal runtime state.
    const hookRuntime = this.hookRuntimeGetter();
    if (supportsClaudeHooks && hookRuntime.state === 'initializing') {
      throw new Error('Hook system is still initializing. Retry session creation shortly.');
    }

    const codexBridgeReady = supportsCodexHooks && this.codexHookBridgeReady;
    const hookMode = resolveCreateHookMode({
      sessionType: supportsClaudeHooks ? 'claude' : supportsCodexHooks ? 'codex' : 'terminal',
      codexBridgeReady,
      hookRuntimeState: hookRuntime.state,
    });

    const args = buildCreateSessionArgs({
      session: input,
      sessionType,
      isTerminal,
      codexBridgeReady,
    });

    // Build account-specific environment overrides.
    // Applied for both Claude and terminal sessions so that auth terminals
    // (terminal sessions with accountId) also see the correct HOME.
    const accountEnv = this.accountManager.getSessionEnv(input.accountId);

    // Insert DB row FIRST so that onFirstData/onExit callbacks can UPDATE it.
    // If spawn fails, we delete the row.
    const db = getDb();
    const worktree = isClaude ? (input.worktree !== undefined ? (input.worktree || '') : null) : null;
    const accountId = input.accountId ?? null;
    const autoClose = input.autoClose === true ? 1 : 0;
    db.prepare(
      `INSERT INTO sessions (session_id, label, label_source, cwd, permission_mode, status, started_at, ended_at, command, hook_mode, session_type, terminal_config, effort, enable_auto_mode, allow_bypass_permissions, worktree, account_id, auto_close)
       VALUES (?, ?, ?, ?, ?, 'starting', ?, NULL, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?)`,
    ).run(sessionId, label, labelSource, cwd, isClaude ? (input.permissionMode ?? null) : null, startedAt, command, hookMode, sessionType, isClaude ? (input.effort ?? null) : null, isClaude ? (input.enableAutoMode === true ? 1 : input.enableAutoMode === false ? 0 : null) : null, isClaude ? (input.allowBypassPermissions === true ? 1 : input.allowBypassPermissions === false ? 0 : null) : null, worktree, accountId, autoClose);

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
        env: {
          MCODE_SESSION_ID: sessionId,
          ...(codexBridgeReady && hookRuntime.port ? { MCODE_HOOK_PORT: String(hookRuntime.port) } : {}),
          ...accountEnv,
        },
        onFirstData: () => {
          if (input.initialCommand) {
            // Session has pre-loaded work — mark active so the task queue
            // won't dispatch to it before the initial command is processed.
            this.updateStatus(sessionId, 'active');
            this.ptyManager.write(sessionId, input.initialCommand + '\n');
          } else {
            // Only transition from 'starting' — hook events (SessionStart,
            // PermissionRequest, etc.) may have already advanced the status.
            const current = this.get(sessionId);
            if (current?.status === 'starting') {
              this.updateStatus(sessionId, isAgentSession(sessionType) ? 'idle' : 'active');
            }
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
        const targetStatus = isAgentSession(sessionType) && !input.initialCommand ? 'idle' : 'active';
        logger.warn('session', 'Starting timeout, forcing status', { sessionId, targetStatus });
        this.updateStatus(sessionId, targetStatus);
      }
    }, 15_000);

    logger.info('session', 'Created session', { sessionId, cwd, label, hookMode });

    if (isCodex) {
      this.scheduleCodexThreadCapture(sessionId, cwd, startedAt, input.initialPrompt);
    }
    if (isGemini) {
      this.scheduleGeminiSessionCapture(sessionId, cwd, command, input.initialPrompt);
    }

    const session = this.get(sessionId)!;
    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('session:created', session);
    }
    return session;
  }

  /** Resume an ended agent session in place. */
  resume(sessionId: string, accountId?: string): SessionInfo {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM sessions WHERE session_id = ?')
      .get(sessionId) as SessionRecord | undefined;

    if (!row) throw new Error(`Session not found: ${sessionId}`);
    if (row.status !== 'ended') throw new Error(`Session is not ended (status: ${row.status})`);

    if (row.session_type === 'gemini') {
      if (!row.gemini_session_id) throw new Error('Cannot resume: no Gemini session ID recorded');

      const command = row.command || 'gemini';
      let resumeIndex: number | null = null;
      try {
        const entries = this.listGeminiSessions(command, row.cwd);
        resumeIndex = resolveGeminiResumeIndex(entries, row.gemini_session_id);
      } catch (err) {
        throw new Error(`Cannot resume Gemini session: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (resumeIndex == null) {
        throw new Error('Cannot resume: stored Gemini session ID is no longer available in Gemini session list');
      }

      db.prepare(
        `UPDATE sessions SET status = 'starting', ended_at = NULL, hook_mode = 'fallback', auto_close = 0 WHERE session_id = ?`,
      ).run(sessionId);

      try {
        this.ptyManager.spawn({
          id: sessionId,
          command,
          cwd: row.cwd,
          cols: DEFAULT_COLS,
          rows: DEFAULT_ROWS,
          args: ['--resume', String(resumeIndex)],
          env: {
            MCODE_SESSION_ID: sessionId,
          },
          onFirstData: () => {
            this.updateStatus(sessionId, 'idle');
          },
          onExit: () => {
            this.updateStatus(sessionId, 'ended');
          },
        });
      } catch (err) {
        db.prepare(
          `UPDATE sessions SET status = 'ended', ended_at = ? WHERE session_id = ?`,
        ).run(new Date().toISOString(), sessionId);
        throw err;
      }

      setTimeout(() => {
        const s = this.get(sessionId);
        if (s && s.status === 'starting') {
          logger.warn('session', 'Starting timeout, forcing idle', { sessionId });
          this.updateStatus(sessionId, 'idle');
        }
      }, 15_000);

      logger.info('session', 'Resumed Gemini session', {
        sessionId,
        geminiSessionId: row.gemini_session_id,
        cwd: row.cwd,
        resumeIndex,
      });

      const session = this.get(sessionId)!;
      this.broadcastSessionUpdate(sessionId);
      return session;
    }

    if (row.session_type === 'codex') {
      if (!row.codex_thread_id) throw new Error('Cannot resume: no Codex thread ID recorded');

      const hookRuntime = this.hookRuntimeGetter();
      const codexBridgeReady = this.codexHookBridgeReady && hookRuntime.state === 'ready';
      const hookMode = codexBridgeReady ? 'live' : 'fallback';
      const command = row.command || 'codex';
      const args = [
        ...(codexBridgeReady ? ['--enable', 'codex_hooks'] : []),
        'resume',
        row.codex_thread_id,
      ];

      db.prepare(
        `UPDATE sessions SET status = 'starting', ended_at = NULL, hook_mode = ?, auto_close = 0 WHERE session_id = ?`,
      ).run(hookMode, sessionId);

      try {
        this.ptyManager.spawn({
          id: sessionId,
          command,
          cwd: row.cwd,
          cols: DEFAULT_COLS,
          rows: DEFAULT_ROWS,
          args,
          env: {
            MCODE_SESSION_ID: sessionId,
            ...(codexBridgeReady && hookRuntime.port ? { MCODE_HOOK_PORT: String(hookRuntime.port) } : {}),
          },
          onFirstData: () => {
            this.updateStatus(sessionId, 'idle');
          },
          onExit: () => {
            this.updateStatus(sessionId, 'ended');
          },
        });
      } catch (err) {
        db.prepare(
          `UPDATE sessions SET status = 'ended', ended_at = ? WHERE session_id = ?`,
        ).run(new Date().toISOString(), sessionId);
        throw err;
      }

      setTimeout(() => {
        const s = this.get(sessionId);
        if (s && s.status === 'starting') {
          logger.warn('session', 'Starting timeout, forcing idle', { sessionId });
          this.updateStatus(sessionId, 'idle');
        }
      }, 15_000);

      logger.info('session', 'Resumed Codex session', {
        sessionId,
        codexThreadId: row.codex_thread_id,
        cwd: row.cwd,
        hookMode,
      });

      const session = this.get(sessionId)!;
      this.broadcastSessionUpdate(sessionId);
      return session;
    }

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

    // Reset session to starting state; clear auto_close so a manual resume
    // doesn't immediately re-kill the session when it goes idle.
    db.prepare(
      `UPDATE sessions SET status = 'starting', ended_at = NULL, hook_mode = ?, auto_close = 0 WHERE session_id = ?`,
    ).run(hookMode, sessionId);

    // Build args: claude --resume <claude_session_id>
    const args: string[] = ['--resume', row.claude_session_id];
    if (row.permission_mode) {
      args.push('--permission-mode', row.permission_mode);
    }
    if (row.effort) {
      args.push('--effort', row.effort);
    }
    if (row.enable_auto_mode) {
      args.push('--enable-auto-mode');
    }
    if (row.allow_bypass_permissions) {
      args.push('--allow-dangerously-skip-permissions');
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
        command: row.command || 'claude',
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

    // Auto-delete ended Claude sessions with no Claude session ID (no interaction occurred).
    if (status === 'ended' && session
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
      .prepare('SELECT status, attention_level, cwd, worktree, last_tool, model, claude_session_id FROM sessions WHERE session_id = ?')
      .get(sessionId) as { status: string; attention_level: string; cwd: string; worktree: string | null; last_tool: string | null; model: string | null; claude_session_id: string | null } | undefined;
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
    // If the state machine says 'ended' but the PTY is still alive, the Claude
    // process is transitioning between sessions (e.g. /resume), not exiting.
    // Keep the current status — the PTY onExit callback will set 'ended' when
    // the process truly terminates.
    const newStatus = (result.status === 'ended' && this.ptyManager.getInfo(sessionId) !== null)
      ? currentStatus
      : result.status;

    // Persist event with computed status
    this.eventStore.persistEvent(sessionId, event, newStatus);

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

    // Model detection from transcript on every hook event.
    // setModel() no-ops when the model is unchanged, so extra reads are harmless.
    {
      const effectiveClaudeSessionId = event.claudeSessionId ?? row.claude_session_id;
      if (effectiveClaudeSessionId) {
        // Prefer authoritative transcript_path from Stop payload; fall back to constructed path
        const payload = event.payload as { transcript_path?: string } | undefined;
        const transcriptPath = payload?.transcript_path
          ?? getTranscriptPath(row.cwd, effectiveClaudeSessionId);
        // Delay on Stop to let Claude finalize the transcript file
        const delay = event.hookEventName === 'Stop' ? 500 : 0;
        setTimeout(() => {
          this.updateModelFromTranscript(sessionId, transcriptPath).catch(() => { });
        }, delay);
      }
    }

    return true;
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

  /** Kill all plain terminal sessions on app close (fire-and-forget to broker). */
  killAllTerminalSessions(): void {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT session_id FROM sessions WHERE session_type = 'terminal' AND status NOT IN ('ended', 'detached')`,
      )
      .all() as { session_id: string }[];
    if (rows.length === 0) return;
    db.prepare(
      `UPDATE sessions SET status = 'ended' WHERE session_type = 'terminal' AND status NOT IN ('ended', 'detached')`,
    ).run();
    for (const row of rows) {
      this.ptyManager.kill(row.session_id).catch(() => { });
    }
    logger.info('session', 'Killed all terminal sessions on close', { count: rows.length });
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

  list(): SessionInfo[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all() as SessionRecord[];
    return rows.map(toSessionInfo);
  }

  /** Return distinct cwds from Claude sessions (lightweight alternative to list()). */
  getDistinctClaudeCwds(): string[] {
    const db = getDb();
    return (
      db.prepare('SELECT DISTINCT cwd FROM sessions WHERE session_type = ?').all('claude') as { cwd: string }[]
    ).map((r) => r.cwd);
  }

  /** Check if any agent (non-terminal) session is in an active-like state. */
  hasActiveAgentSessions(): boolean {
    const db = getDb();
    return !!db
      .prepare(
        "SELECT 1 FROM sessions WHERE session_type != 'terminal' AND status IN ('starting', 'active', 'idle', 'waiting') LIMIT 1",
      )
      .get();
  }

  /** Count active sessions broken down by type (single query). */
  activeSessionCounts(): { agent: number; terminal: number } {
    const db = getDb();
    const row = db
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

  getLastDefaults(): SessionDefaults | null {
    const db = getDb();
    const row = db
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

  setAutoClose(sessionId: string, value: boolean): void {
    const db = getDb();
    db.prepare('UPDATE sessions SET auto_close = ? WHERE session_id = ?').run(value ? 1 : 0, sessionId);
    this.broadcastSessionUpdate(sessionId);
  }

  setModel(sessionId: string, normalizedModel: string): void {
    const db = getDb();
    const row = db.prepare('SELECT model FROM sessions WHERE session_id = ?')
      .get(sessionId) as { model: string | null } | undefined;
    if (!row || row.model === normalizedModel) return;
    db.prepare('UPDATE sessions SET model = ? WHERE session_id = ?').run(normalizedModel, sessionId);
    this.broadcastSessionUpdate(sessionId);
  }

  setCodexThreadId(sessionId: string, codexThreadId: string): void {
    const db = getDb();
    const row = db.prepare('SELECT session_type, codex_thread_id FROM sessions WHERE session_id = ?')
      .get(sessionId) as { session_type: string; codex_thread_id: string | null } | undefined;
    if (!row) throw new Error(`Session not found: ${sessionId}`);
    if (row.session_type !== 'codex') throw new Error('Only Codex sessions can store a Codex thread ID');
    if (row.codex_thread_id === codexThreadId) return;
    db.prepare('UPDATE sessions SET codex_thread_id = ? WHERE session_id = ?').run(codexThreadId, sessionId);
    this.broadcastSessionUpdate(sessionId);
  }

  setGeminiSessionId(sessionId: string, geminiSessionId: string): void {
    const db = getDb();
    const row = db.prepare('SELECT session_type, gemini_session_id FROM sessions WHERE session_id = ?')
      .get(sessionId) as { session_type: string; gemini_session_id: string | null } | undefined;
    if (!row) throw new Error(`Session not found: ${sessionId}`);
    if (row.session_type !== 'gemini') throw new Error('Only Gemini sessions can store a Gemini session ID');
    if (row.gemini_session_id === geminiSessionId) return;
    db.prepare('UPDATE sessions SET gemini_session_id = ? WHERE session_id = ?').run(geminiSessionId, sessionId);
    this.broadcastSessionUpdate(sessionId);
  }

  async updateModelFromTranscript(sessionId: string, transcriptPath: string): Promise<void> {
    let fh: FileHandle;
    try {
      fh = await fsOpen(transcriptPath, 'r');
    } catch { return; }

    try {
      const stats = await fh.stat();
      const tailSize = Math.min(8192, stats.size);
      const buf = Buffer.alloc(tailSize);
      await fh.read(buf, 0, tailSize, stats.size - tailSize);
      const raw = buf.toString('utf-8');
      // Discard first partial line only when reading from mid-file offset
      const isPartialStart = tailSize < stats.size;
      const firstNewline = raw.indexOf('\n');
      const chunk = isPartialStart && firstNewline >= 0 ? raw.slice(firstNewline + 1) : raw;

      const rawModel = extractLatestModel(chunk);
      if (!rawModel) return;

      const normalized = normalizeModelVersion(rawModel);
      this.setModel(sessionId, normalized);
    } finally {
      await fh.close();
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
        `SELECT session_id, status, attention_level, last_tool, session_type FROM sessions
         WHERE status IN ('active', 'idle', 'waiting') AND session_type IN ('claude', 'codex')`,
      )
      .all() as { session_id: string; status: string; attention_level: string; last_tool: string | null; session_type: string }[];

    const now = Date.now();

    for (const row of rows) {
      const buffer = this.ptyManager.getReplayData(row.session_id);
      if (!buffer) continue;

      const lastDataAt = this.ptyManager.getLastDataAt(row.session_id);
      const isQuiescent = lastDataAt > 0 && now - lastDataAt > SessionManager.PTY_QUIESCENCE_MS;

      // Codex: activity-based heuristic only (no prompt detection).
      // For hookMode 'live' sessions, hooks handle state transitions and
      // this polling is just a safety net.
      if (row.session_type === 'codex') {
        if (row.status === 'active' && isQuiescent) {
          this.updateStatusWithAttention(row.session_id, 'idle', 'action', 'Codex finished — awaiting input');
        }
        continue;
      }

      // Claude: full prompt/permission detection
      const tail = stripAnsi(buffer.slice(-2000));
      const rawTail = buffer.slice(-2000);
      const hasPermissionPrompt = SessionManager.PERMISSION_PATTERNS.some((re) => re.test(tail));

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
    return this.eventStore.getRecentEvents(sessionId, limit);
  }

  /** Prune events older than retention period. */
  pruneOldEvents(): void {
    this.eventStore.pruneOldEvents();
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
    logger.info('session', 'Marked agent sessions as detached');
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

  // --- Layout persistence (delegated) ---

  saveLayout(mosaicTree: unknown, sidebarWidth?: number, sidebarCollapsed?: boolean, activeSidebarTab?: string, terminalPanelState?: unknown): void {
    this.layoutRepo.save(mosaicTree, sidebarWidth, sidebarCollapsed, activeSidebarTab, terminalPanelState);
  }

  loadLayout(): { mosaicTree: unknown; sidebarWidth: number; sidebarCollapsed: boolean; activeSidebarTab: string; terminalPanelState: unknown | null } | null {
    return this.layoutRepo.load();
  }

  /** Get recent events across all sessions. */
  getRecentAllEvents(limit = 200): HookEvent[] {
    return this.eventStore.getRecentAllEvents(limit);
  }

  /** Delete all hook events from the database. */
  clearAllEvents(): void {
    this.eventStore.clearAllEvents();
  }
}

export function registerSessionIpc(sessionManager: SessionManager): void {
  typedHandle('session:create', (input) => {
    return sessionManager.create(input);
  });

  typedHandle('session:list', () => {
    return sessionManager.list();
  });

  typedHandle('session:get', (sessionId) => {
    return sessionManager.get(sessionId);
  });

  typedHandle('session:kill', (sessionId) => {
    return sessionManager.kill(sessionId);
  });

  typedHandle('session:delete', (sessionId) => {
    sessionManager.delete(sessionId);
  });

  typedHandle('session:delete-all-ended', () => {
    return sessionManager.deleteAllEnded();
  });

  typedHandle('session:delete-batch', (sessionIds) => {
    return sessionManager.deleteBatch(sessionIds);
  });

  typedHandle('session:get-last-defaults', () => {
    return sessionManager.getLastDefaults();
  });

  typedHandle('session:set-label', (sessionId, label) => {
    sessionManager.setLabel(sessionId, label);
  });

  typedHandle('session:set-auto-label', (sessionId, label) => {
    sessionManager.setAutoLabel(sessionId, label);
  });

  typedHandle('session:set-auto-close', (sessionId, value) => {
    sessionManager.setAutoClose(sessionId, value);
  });

  typedHandle('session:set-terminal-config', (sessionId, config) => {
    sessionManager.setTerminalConfig(sessionId, config);
  });

  typedHandle('session:clear-attention', (sessionId) => {
    sessionManager.clearAttention(sessionId);
  });

  typedHandle('session:clear-all-attention', () => {
    sessionManager.clearAllAttention();
  });

  typedHandle('session:resume', ({ sessionId, accountId }) => {
    return sessionManager.resume(sessionId, accountId);
  });

  typedHandle('session:list-external', async (limit) => {
    const cap = limit ?? 50;
    const cwds = new Set(sessionManager.getDistinctClaudeCwds());
    if (cwds.size === 0) cwds.add(process.cwd());

    const all: ExternalSessionInfo[] = [];
    for (const cwd of cwds) {
      const results = await sessionManager.listExternalSessions(cwd, cap);
      all.push(...results);
    }
    all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return all.slice(0, cap);
  });

  typedHandle('session:import-external', (claudeSessionId, cwd, label) => {
    return sessionManager.importExternal(claudeSessionId, cwd, label);
  });
}

