import type { WebContents } from 'electron';
import type { IPtyManager } from '../shared/pty-manager-interface';
import type { SessionManager } from './session-manager';
import { getDb } from './db';
import { logger } from './logger';
import { stripAnsi } from './strip-ansi';
import type {
  Task,
  TaskStatus,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskChangeEvent,
  HookRuntimeInfo,
  SessionInfo,
} from '../shared/types';

interface TaskRecord {
  id: number;
  prompt: string;
  cwd: string;
  target_session_id: string | null;
  session_id: string | null;
  status: string;
  priority: number;
  scheduled_at: string | null;
  dispatched_at: string | null;
  completed_at: string | null;
  retry_count: number;
  max_retries: number;
  error: string | null;
  created_at: string;
}

interface DispatchState {
  hasStarted: boolean;
  completedViaIdle: boolean;
  dispatchedAtMs: number;
}

/**
 * Check if the terminal buffer tail shows Claude Code's idle prompt (❯).
 * The raw ring buffer is a linear stream — cursor-repositioned content
 * (e.g. the status bar) appears AFTER the prompt character.  We therefore
 * look for the last ❯ and verify only a short tail follows it (status bar
 * is typically < 300 chars on a single line).
 */
function isAtClaudePrompt(rawBufferTail: string): boolean {
  const clean = stripAnsi(rawBufferTail);
  const lastPrompt = clean.lastIndexOf('❯');
  if (lastPrompt === -1) return false;
  const after = clean.slice(lastPrompt + 1);
  // Status bar is short (< 300 chars) and at most 2 newlines.
  // Reject if there is substantial multi-line content (Claude still outputting).
  return after.length < 300 && (after.match(/\n/g) || []).length <= 2;
}

const PROMPT_QUIESCENCE_MS = 2000;
const PROMPT_CHECK_MIN_MS = 1000;

function toTask(row: TaskRecord): Task {
  return {
    id: row.id,
    prompt: row.prompt,
    cwd: row.cwd,
    targetSessionId: row.target_session_id,
    sessionId: row.session_id,
    status: row.status as TaskStatus,
    priority: row.priority,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    dispatchedAt: row.dispatched_at,
    completedAt: row.completed_at,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    error: row.error,
  };
}

const DISPATCH_INTERVAL_MS = 2000;

export class TaskQueue {
  private sessionManager: SessionManager;
  private ptyManager: IPtyManager;
  private getHookRuntimeInfo: () => HookRuntimeInfo;
  private getWebContents: () => WebContents | null;
  private maxConcurrentSessions: number;

  private dispatchTimer: ReturnType<typeof setInterval> | null = null;
  private unsubSessionUpdates: (() => void) | null = null;
  private dispatchStates = new Map<number, DispatchState>();

  constructor(
    sessionManager: SessionManager,
    ptyManager: IPtyManager,
    getHookRuntimeInfo: () => HookRuntimeInfo,
    getWebContents: () => WebContents | null,
    options?: { maxConcurrentSessions?: number },
  ) {
    this.sessionManager = sessionManager;
    this.ptyManager = ptyManager;
    this.getHookRuntimeInfo = getHookRuntimeInfo;
    this.getWebContents = getWebContents;
    this.maxConcurrentSessions = options?.maxConcurrentSessions ?? 5;
  }

  /** Perform startup reconciliation and begin dispatch loop. */
  start(): void {
    this.reconcileOnStartup();

    // Subscribe to session status changes for completion detection
    this.unsubSessionUpdates = this.sessionManager.onSessionUpdated(
      (session) => {
        this.handleSessionUpdate(session);
      },
    );

    // Start periodic dispatch and prompt-based completion detection
    this.dispatchTimer = setInterval(() => {
      this.checkDispatchedForPrompt();
      this.dispatchPending();
    }, DISPATCH_INTERVAL_MS);
  }

  stop(): void {
    if (this.dispatchTimer) {
      clearInterval(this.dispatchTimer);
      this.dispatchTimer = null;
    }
    if (this.unsubSessionUpdates) {
      this.unsubSessionUpdates();
      this.unsubSessionUpdates = null;
    }
    this.dispatchStates.clear();
  }

  // --- Public API ---

  create(input: CreateTaskInput): Task {
    const runtime = this.getHookRuntimeInfo();
    if (runtime.state !== 'ready') {
      throw new Error('Task queue requires live hook mode');
    }

    // Validate target session if specified
    if (input.targetSessionId) {
      const session = this.sessionManager.get(input.targetSessionId);
      if (!session) {
        throw new Error(`Target session not found: ${input.targetSessionId}`);
      }
      if (session.sessionType !== 'claude') {
        throw new Error('Task queue only supports Claude sessions as targets');
      }
      if (session.hookMode !== 'live') {
        throw new Error('Target session must be in live hook mode');
      }
      if (session.status === 'ended') {
        if (!session.claudeSessionId) {
          throw new Error('Target session has ended and cannot be resumed (no Claude session ID)');
        }
        // Resume the ended session so the task runs with its conversation context
        this.sessionManager.resume(input.targetSessionId);
        logger.info('task', 'Resumed ended session for task dispatch', {
          targetSessionId: input.targetSessionId,
        });
      }
    }

    const db = getDb();
    const result = db.prepare(
      `INSERT INTO task_queue (prompt, cwd, target_session_id, priority, scheduled_at, max_retries)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      input.prompt,
      input.cwd,
      input.targetSessionId ?? null,
      input.priority ?? 0,
      input.scheduledAt ?? null,
      input.maxRetries ?? 3,
    );

    const taskId = result.lastInsertRowid as number;
    const task = this.getById(taskId)!;
    logger.info('task', 'Created task', { taskId: task.id, targetSessionId: task.targetSessionId });

    this.broadcastChange({ type: 'upsert', task });

    // Trigger immediate dispatch check
    this.dispatchPending();

    return this.getById(taskId)!;
  }

  list(filter?: TaskFilter): Task[] {
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.statuses && filter.statuses.length > 0) {
      conditions.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`);
      params.push(...filter.statuses);
    }
    if (filter?.targetSessionId) {
      conditions.push('target_session_id = ?');
      params.push(filter.targetSessionId);
    }

    let sql = 'SELECT * FROM task_queue';
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY priority DESC, created_at ASC';

    if (filter?.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = db.prepare(sql).all(...params) as TaskRecord[];
    return rows.map(toTask);
  }

  cancel(taskId: number): void {
    const task = this.getById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'pending') {
      throw new Error(`Cannot cancel task in status "${task.status}" — only pending tasks can be cancelled`);
    }

    const db = getDb();
    db.prepare('DELETE FROM task_queue WHERE id = ?').run(taskId);

    logger.info('task', 'Cancelled task', { taskId });
    this.broadcastChange({ type: 'remove', taskId });
  }

  update(taskId: number, input: UpdateTaskInput): Task {
    const task = this.getById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'pending') {
      throw new Error(`Cannot update task in status "${task.status}" — only pending tasks can be edited`);
    }

    const db = getDb();
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.prompt !== undefined) {
      sets.push('prompt = ?');
      params.push(input.prompt);
    }
    if (input.priority !== undefined) {
      sets.push('priority = ?');
      params.push(input.priority);
    }
    if (input.scheduledAt !== undefined) {
      sets.push('scheduled_at = ?');
      params.push(input.scheduledAt);
    }

    if (sets.length === 0) return task;

    params.push(taskId);
    db.prepare(`UPDATE task_queue SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    const updated = this.getById(taskId)!;
    logger.info('task', 'Updated task', { taskId, fields: Object.keys(input) });
    this.broadcastChange({ type: 'upsert', task: updated });
    return updated;
  }

  getById(taskId: number): Task | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM task_queue WHERE id = ?').get(taskId) as TaskRecord | undefined;
    return row ? toTask(row) : null;
  }

  // --- Startup reconciliation ---

  private reconcileOnStartup(): void {
    const db = getDb();
    const result = db.prepare(
      `UPDATE task_queue SET status = 'failed', error = 'App restarted during task execution', completed_at = ?
       WHERE status = 'dispatched'`,
    ).run(new Date().toISOString());

    if (result.changes > 0) {
      logger.info('task', 'Reconciled stranded dispatched tasks', { count: result.changes });
    }
  }

  // --- Dispatch logic ---

  private dispatchPending(): void {
    const runtime = this.getHookRuntimeInfo();
    if (runtime.state !== 'ready') return;

    const db = getDb();
    const now = new Date().toISOString();

    // Get all pending tasks eligible for dispatch
    const pendingTasks = db.prepare(
      `SELECT * FROM task_queue
       WHERE status = 'pending'
         AND (scheduled_at IS NULL OR scheduled_at <= ?)
       ORDER BY priority DESC, created_at ASC`,
    ).all(now) as TaskRecord[];

    for (const row of pendingTasks) {
      const task = toTask(row);

      if (task.targetSessionId) {
        this.dispatchToExistingSession(task);
      } else {
        this.dispatchNewSession(task);
      }
    }
  }

  private dispatchToExistingSession(task: Task): void {
    const db = getDb();

    // Check if another task is already dispatched on this session
    const dispatched = db.prepare(
      `SELECT id FROM task_queue WHERE target_session_id = ? AND status = 'dispatched' LIMIT 1`,
    ).get(task.targetSessionId!) as { id: number } | undefined;
    if (dispatched) return; // Wait for current task to complete

    // Check target session status
    const session = this.sessionManager.get(task.targetSessionId!);
    if (!session) {
      this.failTask(task.id, 'Target session no longer exists');
      return;
    }
    if (session.status === 'ended') {
      this.failTask(task.id, 'Target session has ended');
      // Also fail remaining pending tasks for this session
      this.failPendingTasksForSession(task.targetSessionId!);
      return;
    }
    if (session.status !== 'idle') return; // Wait for session to become idle

    // Write prompt to PTY
    this.ptyManager.write(task.targetSessionId!, task.prompt + '\r');

    // Mark dispatched
    const dispatchedAt = new Date().toISOString();
    db.prepare(
      `UPDATE task_queue SET status = 'dispatched', session_id = ?, dispatched_at = ? WHERE id = ?`,
    ).run(task.targetSessionId, dispatchedAt, task.id);

    this.dispatchStates.set(task.id, {
      hasStarted: false,
      completedViaIdle: false,
      dispatchedAtMs: Date.now(),
    });

    // Queue-driven PTY input starts a new Claude turn from an idle session.
    // Mark the session active so the UI shows it as working.
    this.sessionManager.updateStatus(task.targetSessionId!, 'active');

    logger.info('task', 'Dispatched task to existing session', {
      taskId: task.id,
      sessionId: task.targetSessionId,
    });

    const updated = this.getById(task.id)!;
    this.broadcastChange({ type: 'upsert', task: updated });
  }

  private dispatchNewSession(task: Task): void {
    const db = getDb();

    // Check concurrency limit: count dispatched new-session tasks
    const dispatchedCount = db.prepare(
      `SELECT COUNT(*) as cnt FROM task_queue WHERE status = 'dispatched' AND target_session_id IS NULL`,
    ).get() as { cnt: number };
    if (dispatchedCount.cnt >= this.maxConcurrentSessions) return;

    try {
      const session = this.sessionManager.create({
        cwd: task.cwd,
        initialPrompt: task.prompt,
      });

      const dispatchedAt = new Date().toISOString();
      db.prepare(
        `UPDATE task_queue SET status = 'dispatched', session_id = ?, dispatched_at = ? WHERE id = ?`,
      ).run(session.sessionId, dispatchedAt, task.id);

      this.dispatchStates.set(task.id, {
        hasStarted: false,
        completedViaIdle: false,
        dispatchedAtMs: Date.now(),
      });

      logger.info('task', 'Dispatched task with new session', {
        taskId: task.id,
        sessionId: session.sessionId,
      });

      const updated = this.getById(task.id)!;
      this.broadcastChange({ type: 'upsert', task: updated });
    } catch (err) {
      this.handleDispatchFailure(task, err instanceof Error ? err.message : String(err));
    }
  }

  // --- Completion detection ---

  private handleSessionUpdate(session: SessionInfo): void {
    // Find dispatched task for this session
    const db = getDb();
    const row = db.prepare(
      `SELECT * FROM task_queue WHERE session_id = ? AND status = 'dispatched' LIMIT 1`,
    ).get(session.sessionId) as TaskRecord | undefined;
    if (!row) return;

    const taskId = row.id;
    const state = this.dispatchStates.get(taskId);
    if (!state) return;

    if (session.status === 'active' && !state.hasStarted) {
      state.hasStarted = true;
    }

    // Completion is detected via PTY prompt detection (checkDispatchedForPrompt),
    // not via idle transition — Stop hooks can fire prematurely for skills
    // or not at all for local slash commands.

    if (session.status === 'ended') {
      if (state.completedViaIdle) {
        // Already completed via idle — just ensure DB is correct
        this.completeTask(taskId);
      } else {
        // Session ended during execution — permanent failure, no retries
        this.failTask(taskId, 'Session ended before completion', true);
        // Fail remaining pending tasks targeting this session
        if (row.target_session_id) {
          this.failPendingTasksForSession(row.target_session_id);
        }
      }
    }
  }

  private checkDispatchedForPrompt(): void {
    const now = Date.now();

    for (const [taskId, state] of this.dispatchStates) {
      if (state.completedViaIdle) continue;
      if (now - state.dispatchedAtMs < PROMPT_CHECK_MIN_MS) continue;

      const task = this.getById(taskId);
      if (!task || task.status !== 'dispatched' || !task.sessionId) continue;

      // Check PTY quiescence: no new output for 2 seconds
      const lastDataAt = this.ptyManager.getLastDataAt(task.sessionId);
      if (lastDataAt === 0) continue;
      if (now - lastDataAt < PROMPT_QUIESCENCE_MS) continue;

      // Check if terminal shows Claude's idle prompt
      const buffer = this.ptyManager.getReplayData(task.sessionId);
      if (!buffer || !isAtClaudePrompt(buffer.slice(-2000))) continue;

      logger.info('task', 'Prompt detected in terminal, completing task', {
        taskId,
        sessionId: task.sessionId,
      });

      // Ensure session status is idle (may still be 'active' if no Stop hook fired)
      this.sessionManager.updateStatus(task.sessionId, 'idle');

      state.completedViaIdle = true;
      this.completeTask(taskId);
    }
  }

  private completeTask(taskId: number): void {
    const db = getDb();
    db.prepare(
      `UPDATE task_queue SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'dispatched'`,
    ).run(new Date().toISOString(), taskId);

    this.dispatchStates.delete(taskId);

    logger.info('task', 'Task completed', { taskId });

    const task = this.getById(taskId);
    if (task) this.broadcastChange({ type: 'upsert', task });

    this.dispatchPending();
  }

  private failTask(taskId: number, error: string, permanent = false): void {
    const db = getDb();
    const task = this.getById(taskId);
    if (!task) return;

    if (!permanent && task.retryCount < task.maxRetries && task.status === 'dispatched') {
      // Retry: reset to pending
      db.prepare(
        `UPDATE task_queue SET status = 'pending', session_id = NULL, dispatched_at = NULL, retry_count = retry_count + 1 WHERE id = ?`,
      ).run(taskId);
      this.dispatchStates.delete(taskId);
      logger.info('task', 'Task retrying', { taskId, retryCount: task.retryCount + 1 });
    } else {
      db.prepare(
        `UPDATE task_queue SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
      ).run(error, new Date().toISOString(), taskId);
      this.dispatchStates.delete(taskId);
      logger.info('task', 'Task failed', { taskId, error });
    }

    const updated = this.getById(taskId);
    if (updated) this.broadcastChange({ type: 'upsert', task: updated });

    if (updated?.status === 'pending') {
      this.dispatchPending();
    }
  }

  private failPendingTasksForSession(targetSessionId: string): void {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM task_queue WHERE target_session_id = ? AND status = 'pending'`,
    ).all(targetSessionId) as TaskRecord[];

    const now = new Date().toISOString();
    for (const row of rows) {
      db.prepare(
        `UPDATE task_queue SET status = 'failed', error = 'Target session ended', completed_at = ? WHERE id = ?`,
      ).run(now, row.id);
      const updated = this.getById(row.id);
      if (updated) this.broadcastChange({ type: 'upsert', task: updated });
      logger.info('task', 'Cascade-failed pending task', { taskId: row.id, targetSessionId });
    }
  }

  private handleDispatchFailure(task: Task, error: string): void {
    const db = getDb();
    if (task.retryCount < task.maxRetries) {
      db.prepare(
        `UPDATE task_queue SET retry_count = retry_count + 1 WHERE id = ?`,
      ).run(task.id);
      logger.info('task', 'Dispatch failed, will retry', { taskId: task.id, error });
    } else {
      db.prepare(
        `UPDATE task_queue SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
      ).run(error, new Date().toISOString(), task.id);
      logger.info('task', 'Dispatch failed permanently', { taskId: task.id, error });
    }
    const updated = this.getById(task.id);
    if (updated) this.broadcastChange({ type: 'upsert', task: updated });
  }

  // --- Broadcasting ---

  private broadcastChange(event: TaskChangeEvent): void {
    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('task:changed', event);
    }
  }
}
