import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { readdir, open as fsOpen } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { WebContents } from 'electron';
import type { IPtyManager } from '../../shared/pty-manager-interface';
import type { AccountManager } from '../account-manager';
import { logger } from '../logger';
import {
  type SessionUpdate,
  getSession as repoGetSession,
  getSessionRecord,
  listSessions as repoListSessions,
  getSessionStatus,
  getSessionHookState,
  getActiveAgentStates,
  getDetachedSessions,
  countActiveSessions as repoCountActiveSessions,
  hasActiveAgentSessions as repoHasActiveAgentSessions,
  getLastClaudeDefaults,
  lookupByClaudeSessionId as repoLookupByClaudeSessionId,
  getDistinctCwds,
  findConflictingLabels,
  getTrackedClaudeSessionIds,
  getEndedSessionIds,
  getEmptyEndedSessionIds,
  hasPendingTasksForSession,
  insertSession,
  updateSession,
  updateAutoLabel,
  setAgentIdIfNull,
  deleteSessionWithEvents,
  deleteSessionsWithEvents,
  markAllEnded,
  markAllDetached,
  markTerminalSessionsEnded,
  clearAllAttention as repoClearAllAttention,
} from './session-repository';
import { extractLatestModel } from '../trackers/jsonl-usage-parser';
import { normalizeModelVersion, normalizeGeminiModel } from '../trackers/token-cost';
import { isAgentSession } from '../../shared/session-agents';
import { getTranscriptPath } from './transcript-path';
import {
  buildSessionLabel,
  getDefaultSessionCommand,
} from './session-launch';
import {
  getAgentRuntimeAdapter,
  type AgentRuntimeAdapterMap,
  type PreparedCreate,
  type PreparedResume,
} from './agent-runtime';
import { createClaudeRuntimeAdapter } from './agent-runtimes/claude-runtime';
import {
  createCodexRuntimeAdapter,
  scheduleCodexThreadCapture,
} from './agent-runtimes/codex-runtime';
import {
  createGeminiRuntimeAdapter,
  listGeminiSessions,
  scheduleGeminiSessionCapture,
} from './agent-runtimes/gemini-runtime';
import {
  createCopilotRuntimeAdapter,
  scheduleCopilotSessionCapture,
} from './agent-runtimes/copilot-runtime';
import {
  computeTransition,
  resolveAttention,
} from './session-state-machine';
import type { HookEventName } from './session-state-machine';
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  HOOK_TOOL_INPUT_MAX_BYTES,
} from '../../shared/constants';
import { SessionEventStore } from './session-event-store';
import { LayoutRepository } from './layout-repository';
import type {
  SessionInfo,
  SessionStatus,
  SessionAttentionLevel,
  SessionCreateInput,
  ExternalSessionInfo,
  HookEvent,
  HookRuntimeInfo,
  TerminalConfig,
} from '../../shared/types';
import { typedHandle } from '../ipc-helpers';


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
  private agentRuntimeAdapters: AgentRuntimeAdapterMap;

  /** Per-agent hook bridge readiness, keyed by session type (e.g. 'codex', 'gemini'). */
  hookBridgeReady: Record<string, boolean> = {};

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
    this.agentRuntimeAdapters = {
      claude: createClaudeRuntimeAdapter(),
      codex: createCodexRuntimeAdapter({
        scheduleThreadCapture: (input) => scheduleCodexThreadCapture(input, {
          broadcastSessionUpdate: (sessionId) => this.broadcastSessionUpdate(sessionId),
        }),
      }),
      gemini: createGeminiRuntimeAdapter({
        scheduleSessionCapture: (input) => scheduleGeminiSessionCapture(input, {
          broadcastSessionUpdate: (sessionId) => this.broadcastSessionUpdate(sessionId),
        }),
        listSessions: (command, cwd) => listGeminiSessions(command, cwd),
      }),
      copilot: createCopilotRuntimeAdapter({
        scheduleSessionCapture: (input) => scheduleCopilotSessionCapture(input, {
          broadcastSessionUpdate: (sessionId) => this.broadcastSessionUpdate(sessionId),
        }),
      }),
    };
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
    const labels = findConflictingLabels(base);
    if (labels.length === 0) return base;
    let max = 1;
    for (const label of labels) {
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
    const hookRuntime = this.hookRuntimeGetter();

    let hookMode: 'live' | 'fallback' = 'fallback';
    let args: string[] = [];
    let spawnEnv: Record<string, string> = {};
    let dbFields: PreparedCreate['dbFields'] = {};

    if (isTerminal) {
      if (input.args) args = [...input.args];
    } else {
      const agentRuntime = getAgentRuntimeAdapter(sessionType, this.agentRuntimeAdapters);
      if (!agentRuntime?.prepareCreate) {
        throw new Error(`No create handler for session type '${sessionType}'`);
      }
      const prepared = agentRuntime.prepareCreate({
        input,
        command,
        hookRuntime,
        agentHookBridgeReady: this.hookBridgeReady[sessionType] ?? false,
      });
      hookMode = prepared.hookMode;
      args = prepared.args;
      spawnEnv = prepared.env;
      dbFields = prepared.dbFields;
    }

    // Build account-specific environment overrides.
    // Applied for both agent and terminal sessions so that auth terminals
    // (terminal sessions with accountId) also see the correct HOME.
    const accountEnv = this.accountManager.getSessionEnv(input.accountId);

    // Insert DB row FIRST so that onFirstData/onExit callbacks can UPDATE it.
    // If spawn fails, we delete the row.
    const accountId = input.accountId ?? null;
    insertSession({
      sessionId,
      label,
      labelSource,
      cwd,
      permissionMode: dbFields.permissionMode ?? null,
      startedAt,
      command,
      hookMode,
      sessionType,
      effort: dbFields.effort ?? null,
      enableAutoMode: dbFields.enableAutoMode ?? null,
      allowBypassPermissions: dbFields.allowBypassPermissions ?? null,
      worktree: dbFields.worktree ?? null,
      accountId,
      autoClose: input.autoClose === true ? 1 : 0,
      model: dbFields.model ?? null,
    });

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
          ...spawnEnv,
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
      deleteSessionWithEvents(sessionId);
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

    const agentRuntime = getAgentRuntimeAdapter(sessionType, this.agentRuntimeAdapters);
    agentRuntime?.afterCreate?.({
      sessionId,
      cwd,
      startedAt,
      command,
      initialPrompt: input.initialPrompt,
    });

    const session = this.get(sessionId)!;
    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('session:created', session);
    }
    return session;
  }

  /** Resume an ended agent session in place. */
  resume(sessionId: string, accountId?: string): SessionInfo {
    const row = getSessionRecord(sessionId);

    if (!row) throw new Error(`Session not found: ${sessionId}`);
    if (row.status !== 'ended') throw new Error(`Session is not ended (status: ${row.status})`);

    const agentRuntime = getAgentRuntimeAdapter(row.session_type, this.agentRuntimeAdapters);
    if (!agentRuntime?.prepareResume) {
      throw new Error(`Cannot resume: no resume handler for session type '${row.session_type}'`);
    }

    const prepared = agentRuntime.prepareResume({
      sessionId,
      row: {
        command: row.command,
        cwd: row.cwd,
        codexThreadId: row.codex_thread_id,
        geminiSessionId: row.gemini_session_id,
        claudeSessionId: row.claude_session_id,
        copilotSessionId: row.copilot_session_id,
        permissionMode: row.permission_mode,
        effort: row.effort,
        enableAutoMode: row.enable_auto_mode === 1,
        allowBypassPermissions: row.allow_bypass_permissions === 1,
        worktree: row.worktree,
      },
      hookRuntime: this.hookRuntimeGetter(),
      agentHookBridgeReady: this.hookBridgeReady[row.session_type] ?? false,
    });

    // Account handling (generic for all agents)
    const effectiveAccountId = accountId ?? row.account_id ?? undefined;
    if (accountId && accountId !== row.account_id) {
      updateSession(sessionId, { accountId });
    }
    const accountEnv = this.accountManager.getSessionEnv(effectiveAccountId);
    prepared.env = { ...prepared.env, ...accountEnv };

    return this.resumeWithPreparedPlan(sessionId, prepared);
  }

  private resumeWithPreparedPlan(sessionId: string, prepared: PreparedResume): SessionInfo {
    updateSession(sessionId, {
      status: 'starting',
      endedAt: null,
      hookMode: prepared.hookMode,
      autoClose: 0,
      lastTool: null,
      lastEventAt: null,
      attentionLevel: 'none',
      attentionReason: null,
    });

    try {
      this.ptyManager.spawn({
        id: sessionId,
        command: prepared.command,
        cwd: prepared.cwd,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        args: prepared.args,
        env: {
          MCODE_SESSION_ID: sessionId,
          ...prepared.env,
        },
        onFirstData: () => {
          this.updateStatus(sessionId, 'idle');
        },
        onExit: () => {
          this.updateStatus(sessionId, 'ended');
        },
      });
    } catch (err) {
      updateSession(sessionId, { status: 'ended', endedAt: new Date().toISOString() });
      throw err;
    }

    setTimeout(() => {
      const s = this.get(sessionId);
      if (s && s.status === 'starting') {
        logger.warn('session', 'Starting timeout, forcing idle', { sessionId });
        this.updateStatus(sessionId, 'idle');
      }
    }, 15_000);

    logger.info('session', `Resumed ${prepared.logLabel} session`, {
      sessionId,
      ...prepared.logContext,
    });

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

    insertSession({
      sessionId,
      label,
      cwd,
      startedAt,
      claudeSessionId,
      hookMode,
      sessionType: 'claude',
    });

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
      deleteSessionWithEvents(sessionId);
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
    const tracked = getTrackedClaudeSessionIds();

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
    // Idempotency guard — skip if already in target state
    const currentStatus = getSessionStatus(sessionId);
    if (!currentStatus || currentStatus === status) return;
    // Don't transition away from ended or detached→ended (both terminal-ish, but detached can recover)
    if (currentStatus === 'ended') return;

    const previousStatus = currentStatus as SessionStatus;

    if (status === 'ended') {
      updateSession(sessionId, {
        status,
        endedAt: new Date().toISOString(),
        attentionLevel: 'none',
        attentionReason: null,
      });
    } else {
      updateSession(sessionId, { status });
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
    // Verify session exists
    let row = getSessionHookState(sessionId);
    if (!row) {
      logger.warn('session', 'Hook event for unknown session', { sessionId, event: event.hookEventName });
      return false;
    }

    // Don't process events for ended sessions
    if (row.status === 'ended') return true;

    // Persist agent-native session ID if present (route to correct column by session type)
    if (event.claudeSessionId) {
      if (row.session_type === 'claude') {
        updateSession(sessionId, { claudeSessionId: event.claudeSessionId });
      } else if (row.session_type === 'gemini' && !row.gemini_session_id) {
        setAgentIdIfNull(sessionId, 'gemini_session_id', event.claudeSessionId);
      }
    }

    // Copilot: capture sessionId from hook payload on SessionStart
    if (row.session_type === 'copilot' && !row.copilot_session_id && event.hookEventName === 'SessionStart') {
      const copilotSessionId = event.payload?.sessionId as string | undefined;
      if (copilotSessionId) {
        if (setAgentIdIfNull(sessionId, 'copilot_session_id', copilotSessionId)) {
          logger.info('session', 'Captured Copilot session ID from hook', {
            sessionId,
            copilotSessionId,
          });
        }
      }
    }

    // Capture auto-generated worktree name from hook event cwd
    if (row.worktree === '' && typeof event.payload.cwd === 'string') {
      const worktreePrefix = join(row.cwd, '.claude', 'worktrees') + '/';
      if (event.payload.cwd.startsWith(worktreePrefix)) {
        const rest = event.payload.cwd.slice(worktreePrefix.length);
        const name = rest.split('/')[0];
        if (name) {
          updateSession(sessionId, { worktree: name });
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
      ? hasPendingTasksForSession(sessionId)
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

    // Build update as typed fields instead of raw SQL
    const fields: SessionUpdate = { lastEventAt: event.createdAt };

    if (newStatus !== currentStatus) {
      fields.status = newStatus;
      if (newStatus === 'ended') {
        fields.endedAt = new Date().toISOString();
      }
    }

    if (newAttention !== currentAttention) {
      fields.attentionLevel = newAttention;
      fields.attentionReason = attentionReason;
    } else if (attentionReason !== null) {
      fields.attentionReason = attentionReason;
    }

    if (result.lastTool.type === 'set') {
      fields.lastTool = result.lastTool.toolName;
    } else if (result.lastTool.type === 'clear') {
      fields.lastTool = null;
    }

    updateSession(sessionId, fields);

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

    // Gemini model detection from BeforeModel hook payload
    if (event.hookEventName === 'BeforeModel' && row.session_type === 'gemini') {
      const llmRequest = (event.payload as { llm_request?: { model?: string } }).llm_request;
      const rawModel = typeof llmRequest?.model === 'string' ? llmRequest.model : null;
      if (rawModel) {
        this.setModel(sessionId, normalizeGeminiModel(rawModel));
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
    const status = getSessionStatus(sessionId);
    if (status === null) throw new Error(`Session not found: ${sessionId}`);
    if (status !== 'ended') throw new Error(`Session is not ended (status: ${status}). Kill it first.`);

    deleteSessionWithEvents(sessionId);

    logger.info('session', 'Deleted session', { sessionId });

    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('session:deleted', sessionId);
    }
  }

  deleteAllEnded(): string[] {
    const ids = getEndedSessionIds();
    if (ids.length === 0) return [];

    deleteSessionsWithEvents(ids);

    logger.info('session', 'Deleted all ended sessions', { count: ids.length });

    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('session:deleted-batch', ids);
    }
    return ids;
  }

  /** Delete all ended Claude sessions that never received a claude_session_id. */
  deleteEmptyEnded(): number {
    const ids = getEmptyEndedSessionIds();
    if (ids.length === 0) return 0;

    deleteSessionsWithEvents(ids);

    logger.info('session', 'Deleted empty Claude sessions', { count: ids.length });

    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('session:deleted-batch', ids);
    }
    return ids.length;
  }

  deleteBatch(sessionIds: string[]): string[] {
    const validIds: string[] = [];
    for (const id of sessionIds) {
      if (getSessionStatus(id) === 'ended') {
        validIds.push(id);
      }
    }
    if (validIds.length === 0) return [];

    deleteSessionsWithEvents(validIds);

    logger.info('session', 'Deleted batch of sessions', { count: validIds.length });

    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('session:deleted-batch', validIds);
    }
    return validIds;
  }

  /** Kill all plain terminal sessions on app close (fire-and-forget to broker). */
  killAllTerminalSessions(): void {
    const ids = markTerminalSessionsEnded();
    if (ids.length === 0) return;
    for (const id of ids) {
      this.ptyManager.kill(id).catch(() => { });
    }
    logger.info('session', 'Killed all terminal sessions on close', { count: ids.length });
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
    return repoGetSession(sessionId);
  }

  list(): SessionInfo[] {
    return repoListSessions();
  }

  /** Return distinct cwds from Claude sessions (lightweight alternative to list()). */
  getDistinctClaudeCwds(): string[] {
    return getDistinctCwds('claude');
  }

  /** Check if any agent (non-terminal) session is in an active-like state. */
  hasActiveAgentSessions(): boolean {
    return repoHasActiveAgentSessions();
  }

  /** Count active sessions broken down by type (single query). */
  activeSessionCounts(): { agent: number; terminal: number } {
    return repoCountActiveSessions();
  }

  getLastDefaults() {
    return getLastClaudeDefaults();
  }

  setLabel(sessionId: string, label: string): void {
    updateSession(sessionId, { label, labelSource: 'user' });
    this.broadcastSessionUpdate(sessionId);
  }

  /**
   * Update label only if it was not manually renamed by the user.
   * Used for auto-generated titles (e.g. terminal OSC title from Claude Code).
   */
  setAutoLabel(sessionId: string, label: string): void {
    if (updateAutoLabel(sessionId, label)) {
      this.broadcastSessionUpdate(sessionId);
    }
  }

  setAutoClose(sessionId: string, value: boolean): void {
    updateSession(sessionId, { autoClose: value ? 1 : 0 });
    this.broadcastSessionUpdate(sessionId);
  }

  setModel(sessionId: string, normalizedModel: string): void {
    const record = getSessionRecord(sessionId);
    if (!record || record.model === normalizedModel) return;
    updateSession(sessionId, { model: normalizedModel });
    this.broadcastSessionUpdate(sessionId);
  }

  setCodexThreadId(sessionId: string, codexThreadId: string): void {
    const record = getSessionRecord(sessionId);
    if (!record) throw new Error(`Session not found: ${sessionId}`);
    if (record.session_type !== 'codex') throw new Error('Only Codex sessions can store a Codex thread ID');
    if (record.codex_thread_id === codexThreadId) return;
    updateSession(sessionId, { codexThreadId });
    this.broadcastSessionUpdate(sessionId);
  }

  setGeminiSessionId(sessionId: string, geminiSessionId: string): void {
    const record = getSessionRecord(sessionId);
    if (!record) throw new Error(`Session not found: ${sessionId}`);
    if (record.session_type !== 'gemini') throw new Error('Only Gemini sessions can store a Gemini session ID');
    if (record.gemini_session_id === geminiSessionId) return;
    updateSession(sessionId, { geminiSessionId });
    this.broadcastSessionUpdate(sessionId);
  }

  setCopilotSessionId(sessionId: string, copilotSessionId: string): void {
    const record = getSessionRecord(sessionId);
    if (!record) throw new Error(`Session not found: ${sessionId}`);
    if (record.session_type !== 'copilot') throw new Error('Only Copilot sessions can store a Copilot session ID');
    if (record.copilot_session_id === copilotSessionId) return;
    updateSession(sessionId, { copilotSessionId });
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
    const record = getSessionRecord(sessionId);
    const existing: TerminalConfig = JSON.parse(record?.terminal_config || '{}');
    const merged = { ...existing, ...partial };
    updateSession(sessionId, { terminalConfig: JSON.stringify(merged) });
    this.broadcastSessionUpdate(sessionId);
  }

  clearAttention(sessionId: string): void {
    updateSession(sessionId, { attentionLevel: 'none', attentionReason: null });
    this.broadcastSessionUpdate(sessionId);
  }

  clearAllAttention(): void {
    const changedIds = repoClearAllAttention();
    for (const id of changedIds) {
      this.broadcastSessionUpdate(id);
    }
  }

  /** Atomically set status + attention in one DB update. */
  updateStatusWithAttention(
    sessionId: string,
    status: SessionStatus,
    attention: SessionAttentionLevel,
    reason: string | null,
  ): void {
    const currentStatus = getSessionStatus(sessionId);
    if (!currentStatus || currentStatus === status || currentStatus === 'ended') return;

    const previousStatus = currentStatus as SessionStatus;

    const fields: SessionUpdate = { status, attentionLevel: attention, attentionReason: reason };
    if (status === 'ended') {
      fields.endedAt = new Date().toISOString();
    }
    updateSession(sessionId, fields);

    logger.info('session', 'Status+attention changed', { sessionId, status, attention });
    this.broadcastSessionUpdate(sessionId);

    const session = this.get(sessionId);
    if (session) this.notifyListeners(session, previousStatus);
  }

  // --- PTY-based state detection ---

  private static readonly PTY_QUIESCENCE_MS = 5000;

  /** Poll active agent sessions and delegate state detection to runtime adapters. */
  pollSessionStates(): void {
    const rows = getActiveAgentStates();
    const now = Date.now();

    for (const row of rows) {
      const adapter = this.agentRuntimeAdapters[row.session_type as keyof AgentRuntimeAdapterMap];
      if (!adapter?.pollState) continue;

      const buffer = this.ptyManager.getReplayData(row.session_id);
      if (!buffer) continue;

      const lastDataAt = this.ptyManager.getLastDataAt(row.session_id);
      const isQuiescent = lastDataAt > 0 && now - lastDataAt > SessionManager.PTY_QUIESCENCE_MS;

      const hasPendingTasks = hasPendingTasksForSession(row.session_id);

      const update = adapter.pollState({
        sessionId: row.session_id,
        status: row.status as SessionStatus,
        attentionLevel: row.attention_level as SessionAttentionLevel,
        lastTool: row.last_tool,
        buffer,
        lastDataAt,
        isQuiescent,
        hasPendingTasks,
      });

      if (!update) continue;

      if (update.attention) {
        this.updateStatusWithAttention(row.session_id, update.status, update.attention.level, update.attention.reason);
      } else {
        this.updateStatus(row.session_id, update.status);
      }
    }
  }

  /** Look up an mcode session ID by Claude's session_id. */
  lookupByClaudeSessionId(claudeSessionId: string): string | null {
    return repoLookupByClaudeSessionId(claudeSessionId);
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
    markAllEnded(new Date().toISOString());
    logger.info('session', 'Marked all active sessions as ended');
  }

  /** Mark all running sessions as detached (PTY broker is keeping them alive). Called on normal quit. */
  detachAllActive(): void {
    markAllDetached();
    logger.info('session', 'Marked agent sessions as detached');
  }

  /**
   * Reconcile detached sessions against what the PTY broker reports as alive.
   * Called on app open after connecting to the broker.
   */
  reconcileDetachedSessions(aliveSessionIds: string[]): void {
    const aliveSet = new Set(aliveSessionIds);
    const detached = getDetachedSessions();

    for (const { session_id, pre_detach_status } of detached) {
      if (aliveSet.has(session_id)) {
        const restoreStatus = (pre_detach_status || 'active') as SessionStatus;
        this.updateStatus(session_id, restoreStatus);
        updateSession(session_id, { preDetachStatus: null });
        logger.info('session', 'Reconnected to running session', { sessionId: session_id, restoredStatus: restoreStatus });
      } else {
        this.updateStatus(session_id, 'ended');
        updateSession(session_id, { preDetachStatus: null });
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
