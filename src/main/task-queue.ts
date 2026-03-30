import { openSync, readSync, statSync, closeSync } from 'fs';
import type { WebContents } from 'electron';
import type { IPtyManager } from '../shared/pty-manager-interface';
import type { SessionManager } from './session/session-manager';
import { getDb } from './db';
import { updateSession } from './session/session-repository';
import { logger } from './logger';
import { isAtClaudePrompt, isAtUserChoice, parseUserChoices } from './session/prompt-detect';
import { getTranscriptPath } from './session/transcript-path';
import { typedHandle } from './ipc-helpers';
import type {
  Task,
  TaskStatus,
  TaskPermissionMode,
  PlanModeAction,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskChangeEvent,
  HookRuntimeInfo,
  SessionInfo,
} from '../shared/types';
import { getAgentDefinition } from '../shared/session-agents';
import { hasLiveTaskQueue } from '../shared/session-capabilities';

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
  plan_mode_action: string | null;
  sort_order: number | null;
  permission_mode: string | null;
}

interface DispatchState {
  hasStarted: boolean;
  completedViaIdle: boolean;
  dispatchedAtMs: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
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
    planModeAction: row.plan_mode_action ? (JSON.parse(row.plan_mode_action) as PlanModeAction) : null,
    sortOrder: row.sort_order,
    permissionMode: (row.permission_mode as TaskPermissionMode) ?? null,
  };
}

const DISPATCH_INTERVAL_MS = 2000;
const SHIFT_TAB_DELAY_MS = 150;

// --- Permission mode cycling helpers (exported for testing) ---

import { buildModeCycle } from '../shared/task-utils';
export { buildModeCycle };

/**
 * Calculate the number of forward Shift+Tab presses to go from `current` to `target`
 * in the given cycle. Returns -1 if either mode is not in the cycle.
 */
export function calcShiftTabPresses(cycle: string[], current: string, target: string): number {
  const curIdx = cycle.indexOf(current);
  const tgtIdx = cycle.indexOf(target);
  if (curIdx === -1 || tgtIdx === -1) return -1;
  return (tgtIdx - curIdx + cycle.length) % cycle.length;
}

/**
 * Read the current permission mode for a session.
 * 1. Try the JSONL session log (last human message's permissionMode field)
 * 2. Fallback to the DB-stored permission_mode from session creation
 */
export function getCurrentPermissionMode(session: SessionInfo): string {
  if (session.claudeSessionId) {
    const mode = readLastPermissionModeFromJsonl(session.cwd, session.claudeSessionId);
    if (mode) return mode;
  }
  return session.permissionMode ?? 'default';
}

/**
 * Read the last permissionMode from a Claude Code JSONL session log.
 * Reads the tail of the file for efficiency.
 */
function readLastPermissionModeFromJsonl(cwd: string, claudeSessionId: string): string | null {
  try {
    const jsonlPath = getTranscriptPath(cwd, claudeSessionId);
    const stat = statSync(jsonlPath);
    const readSize = Math.min(stat.size, 16384); // Read last 16KB
    const buf = Buffer.alloc(readSize);
    const fd = openSync(jsonlPath, 'r');
    try {
      readSync(fd, buf, 0, readSize, stat.size - readSize);
    } finally {
      closeSync(fd);
    }
    const content = buf.toString('utf-8');
    const lines = content.split('\n');
    // Iterate from end to find last human message with permissionMode
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'user' && obj.permissionMode) {
          return obj.permissionMode as string;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // File doesn't exist or can't be read — fall through to fallback
  }
  return null;
}

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
      if (!hasLiveTaskQueue(session)) {
        throw new Error('Target session does not support task queue (requires live hook mode and a supported agent type)');
      }

      // Hardcoded to claude — permission mode cycling depends on Claude's
      // Shift+Tab UX and buildModeCycle(); no capability flag needed.
      if (input.permissionMode && session.sessionType !== 'claude') {
        throw new Error('Permission mode cycling is only supported for Claude sessions');
      }

      const agentDef = getAgentDefinition(session.sessionType);
      if (input.planModeAction && !agentDef?.supportsPlanMode) {
        throw new Error('Plan mode tasks are only supported for agents with plan-mode capability');
      }

      // Validate permissionMode reachability BEFORE resuming an ended session
      // so we don't needlessly resume if the mode is invalid.
      if (input.permissionMode) {
        if (input.permissionMode === 'dontAsk') {
          throw new Error('dontAsk is never reachable via Shift+Tab cycling');
        }
        const cycle = buildModeCycle(session);
        if (!cycle.includes(input.permissionMode)) {
          const available = cycle.join(', ');
          throw new Error(
            `Permission mode '${input.permissionMode}' is not reachable via Shift+Tab for this session. ` +
            `Available modes: ${available}`,
          );
        }
      }

      if (session.status === 'ended') {
        if (input.planModeAction) {
          throw new Error('Cannot create plan mode response for an ended session');
        }
        const identityKind = agentDef?.resumeIdentityKind;
        if (identityKind && !session[identityKind]) {
          throw new Error(`Target session has ended and cannot be resumed (no ${identityKind})`);
        }
        // Resume the ended session so the task runs with its conversation context
        this.sessionManager.resume(input.targetSessionId);
        logger.info('task', 'Resumed ended session for task dispatch', {
          targetSessionId: input.targetSessionId,
        });
      }
    }

    if (input.planModeAction && !input.targetSessionId) {
      throw new Error('Plan mode response tasks must target an existing session');
    }

    if (input.permissionMode && !input.targetSessionId) {
      throw new Error('permissionMode requires a target session (Shift+Tab cycling only works on existing sessions)');
    }

    const db = getDb();

    // Compute sort_order for session-targeted tasks
    let sortOrder: number | null = null;
    if (input.targetSessionId) {
      const row = db.prepare(
        `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
         FROM task_queue
         WHERE target_session_id = ? AND status IN ('pending', 'dispatched')`,
      ).get(input.targetSessionId) as { next_order: number };
      sortOrder = row.next_order;
    }

    const result = db.prepare(
      `INSERT INTO task_queue (prompt, cwd, target_session_id, priority, scheduled_at, max_retries, plan_mode_action, sort_order, permission_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.prompt,
      input.cwd,
      input.targetSessionId ?? null,
      input.priority ?? 0,
      input.scheduledAt ?? null,
      input.maxRetries ?? 3,
      input.planModeAction ? JSON.stringify(input.planModeAction) : null,
      sortOrder,
      input.permissionMode ?? null,
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
    sql += ' ORDER BY sort_order ASC NULLS LAST, priority DESC, created_at ASC';

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

  cancelAllPending(): number {
    const db = getDb();
    const result = db.prepare("DELETE FROM task_queue WHERE status = 'pending'").run();
    if (result.changes > 0) {
      logger.info('task', 'Cancelled all pending tasks', { count: result.changes });
      this.broadcastChange({ type: 'refresh' });
    }
    return result.changes;
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

  reorder(taskId: number, direction: 'up' | 'down'): Task {
    const task = this.getById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'pending') {
      throw new Error(`Cannot reorder task in status "${task.status}" — only pending tasks can be reordered`);
    }
    if (!task.targetSessionId) {
      throw new Error('Cannot reorder standalone tasks — only session-targeted tasks support reordering');
    }
    if (task.sortOrder == null) {
      throw new Error('Task has no sort order assigned');
    }

    const db = getDb();

    // Find adjacent pending task in the same session
    const adjacentSql = direction === 'up'
      ? `SELECT * FROM task_queue
         WHERE target_session_id = ? AND status = 'pending' AND sort_order < ?
         ORDER BY sort_order DESC LIMIT 1`
      : `SELECT * FROM task_queue
         WHERE target_session_id = ? AND status = 'pending' AND sort_order > ?
         ORDER BY sort_order ASC LIMIT 1`;

    const adjacent = db.prepare(adjacentSql).get(
      task.targetSessionId,
      task.sortOrder,
    ) as TaskRecord | undefined;

    if (!adjacent) {
      throw new Error(`Task is already at the ${direction === 'up' ? 'top' : 'bottom'}`);
    }

    // Swap sort_order values in a transaction
    const swap = db.transaction(() => {
      db.prepare('UPDATE task_queue SET sort_order = ? WHERE id = ?').run(adjacent.sort_order, task.id);
      db.prepare('UPDATE task_queue SET sort_order = ? WHERE id = ?').run(task.sortOrder, adjacent.id);
    });
    swap();

    logger.info('task', 'Reordered task', { taskId, direction, swappedWith: adjacent.id });

    const updatedTask = this.getById(taskId)!;
    const updatedAdjacent = this.getById(adjacent.id)!;
    this.broadcastChange({ type: 'upsert', task: updatedTask });
    this.broadcastChange({ type: 'upsert', task: updatedAdjacent });

    return updatedTask;
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
       ORDER BY sort_order ASC NULLS LAST, priority DESC, created_at ASC`,
    ).all(now) as TaskRecord[];

    for (const row of pendingTasks) {
      const task = toTask(row);

      if (task.targetSessionId) {
        if (task.planModeAction) {
          this.dispatchPlanModeTask(task);
        } else {
          this.dispatchToExistingSession(task);
        }
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

    // Check if we need to cycle permission mode before dispatching
    if (task.permissionMode) {
      const currentMode = getCurrentPermissionMode(session);
      const cycle = buildModeCycle(session);
      const presses = calcShiftTabPresses(cycle, currentMode, task.permissionMode);

      if (presses === -1) {
        // Current mode not in cycle — shouldn't happen (validated at creation) but log and proceed without cycling
        logger.warn('task', 'Cannot determine Shift+Tab presses; dispatching without mode cycling', {
          taskId: task.id,
          currentMode,
          targetMode: task.permissionMode,
        });
      } else if (presses > 0) {
        this.cycleAndDispatch(task, presses);
        return;
      }
    }

    this.writePromptAndMarkDispatched(task);
  }

  /**
   * Send N Shift+Tab presses with delays, then dispatch the prompt.
   * Follows the same setTimeout pattern as dispatchPlanModeTask.
   */
  private cycleAndDispatch(task: Task, presses: number): void {
    const db = getDb();

    // Mark dispatched immediately (same as dispatchPlanModeTask)
    const dispatchedAt = new Date().toISOString();
    db.prepare(
      `UPDATE task_queue SET status = 'dispatched', session_id = ?, dispatched_at = ? WHERE id = ?`,
    ).run(task.targetSessionId, dispatchedAt, task.id);

    this.dispatchStates.set(task.id, {
      hasStarted: false,
      completedViaIdle: false,
      dispatchedAtMs: Date.now(),
      idleTimer: null,
    });

    logger.info('task', 'Cycling permission mode before dispatch', {
      taskId: task.id,
      sessionId: task.targetSessionId,
      targetMode: task.permissionMode,
      shiftTabPresses: presses,
    });

    const updated = this.getById(task.id)!;
    this.broadcastChange({ type: 'upsert', task: updated });

    // Send Shift+Tab presses with SHIFT_TAB_DELAY_MS intervals
    let sent = 0;
    const sendNext = (): void => {
      const currentSession = this.sessionManager.get(task.targetSessionId!);
      if (!currentSession || currentSession.status === 'ended') return;

      if (sent < presses) {
        this.ptyManager.write(task.targetSessionId!, '\x1b[Z');
        sent++;
        setTimeout(sendNext, SHIFT_TAB_DELAY_MS);
      } else {
        // All presses sent — wait for mode to settle, then send prompt
        setTimeout(() => {
          const sess = this.sessionManager.get(task.targetSessionId!);
          if (!sess || sess.status === 'ended') return;
          this.ptyManager.write(task.targetSessionId!, task.prompt + '\r');
          this.sessionManager.updateStatus(task.targetSessionId!, 'active');

          // Update DB permission_mode so future tasks have accurate state
          if (task.permissionMode) {
            const modeForDb = task.permissionMode === 'default' ? null : task.permissionMode;
            updateSession(task.targetSessionId!, { permissionMode: modeForDb });
          }

          logger.info('task', 'Dispatched task after permission mode cycling', {
            taskId: task.id,
            sessionId: task.targetSessionId,
          });
        }, SHIFT_TAB_DELAY_MS);
      }
    };

    sendNext();
  }

  /** Write prompt to PTY and mark the task as dispatched. Shared by direct dispatch and post-cycling dispatch. */
  private writePromptAndMarkDispatched(task: Task): void {
    const db = getDb();

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
      idleTimer: null,
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

  private dispatchPlanModeTask(task: Task): void {
    const db = getDb();

    // Check if another task is already dispatched on this session
    const dispatched = db.prepare(
      `SELECT id FROM task_queue WHERE target_session_id = ? AND status = 'dispatched' LIMIT 1`,
    ).get(task.targetSessionId!) as { id: number } | undefined;
    if (dispatched) return;

    const session = this.sessionManager.get(task.targetSessionId!);
    if (!session) {
      this.failTask(task.id, 'Target session no longer exists');
      return;
    }
    if (session.status === 'ended') {
      this.failTask(task.id, 'Target session has ended');
      this.failPendingTasksForSession(task.targetSessionId!);
      return;
    }
    if (session.status !== 'waiting') return; // Wait for session to enter plan mode

    const buffer = this.ptyManager.getReplayData(task.targetSessionId!);
    if (!buffer || !isAtUserChoice(buffer.slice(-500))) return;

    const choices = parseUserChoices(buffer);
    const typeHere = choices.find((c) => /type here/i.test(c.text));
    if (!typeHere) return; // Not a plan mode menu (e.g. permission prompt); stay pending

    // Navigate to "Type here" option: (index-1) ↓ presses, then Enter to enter text sub-mode
    const navKeys = '\x1b[B'.repeat(typeHere.index - 1) + '\r';
    this.ptyManager.write(task.targetSessionId!, navKeys);

    // Mark dispatched immediately
    const dispatchedAt = new Date().toISOString();
    db.prepare(
      `UPDATE task_queue SET status = 'dispatched', session_id = ?, dispatched_at = ? WHERE id = ?`,
    ).run(task.targetSessionId, dispatchedAt, task.id);

    this.dispatchStates.set(task.id, {
      hasStarted: false,
      completedViaIdle: false,
      dispatchedAtMs: Date.now(),
      idleTimer: null,
    });

    logger.info('task', 'Dispatched plan mode task', {
      taskId: task.id,
      sessionId: task.targetSessionId,
      typeHereIndex: typeHere.index,
    });

    const updated = this.getById(task.id)!;
    this.broadcastChange({ type: 'upsert', task: updated });

    // After the text sub-mode activates (~300ms), type the message
    setTimeout(() => {
      const currentSession = this.sessionManager.get(task.targetSessionId!);
      if (!currentSession || currentSession.status === 'ended') return;
      this.ptyManager.write(task.targetSessionId!, task.prompt + '\r');
      this.sessionManager.updateStatus(task.targetSessionId!, 'active');
    }, 300);
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
        idleTimer: null,
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
    if (!row) {
      // No dispatched task — if session just went idle and has autoClose, check for drain.
      if (session.status === 'idle' && session.autoClose) {
        this.maybeScheduleAutoClose(session.sessionId);
      }
      return;
    }

    const taskId = row.id;
    const state = this.dispatchStates.get(taskId);
    if (!state) return;

    if (session.status === 'active' && !state.hasStarted) {
      state.hasStarted = true;
    }

    // Cancel pending idle timer when session resumes work
    if (session.status === 'active' && state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }

    // Debounce: complete task only if session stays idle for 500ms.
    // The session manager's hook-driven idle status is authoritative.
    // The debounce guards against brief mid-skill idle transitions
    // (where the session goes idle→active→idle between turns).
    if (session.status === 'idle' && state.hasStarted && !state.idleTimer) {
      const sessionId = session.sessionId;
      state.idleTimer = setTimeout(() => {
        const s = this.dispatchStates.get(taskId);
        if (!s || s.completedViaIdle) return;
        const t = this.getById(taskId);
        if (!t || t.status !== 'dispatched') return;
        const cur = this.sessionManager.get(sessionId);
        // Clear timer ref before completeTask (which deletes the state)
        s.idleTimer = null;
        if (cur?.status === 'idle') {
          s.completedViaIdle = true;
          this.completeTask(taskId);
        }
      }, 500);
    }

    // Cancel pending idle timer when session enters waiting (not idle anymore)
    if (session.status === 'waiting' && state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }

    // Plan mode tasks also complete when a new user-choice menu appears
    if (session.status === 'waiting' && state.hasStarted && row.plan_mode_action) {
      const agentDef = getAgentDefinition(session.sessionType);
      if (agentDef?.supportsPlanMode) {
        const buffer = this.ptyManager.getReplayData(session.sessionId);
        if (buffer && isAtUserChoice(buffer.slice(-500))) {
          state.completedViaIdle = true;
          this.completeTask(taskId);
          return;
        }
      }
    }

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

  /** Fallback completion detection via polling.
   *  The primary path is handleSessionUpdate (event-driven via hooks)
   *  with a debounced idle timer.  This fallback handles cases where
   *  hooks don't fire or the debounced timer didn't complete the task. */
  private checkDispatchedForPrompt(): void {
    const now = Date.now();

    for (const [taskId, state] of this.dispatchStates) {
      if (state.completedViaIdle) continue;
      if (now - state.dispatchedAtMs < PROMPT_CHECK_MIN_MS) continue;

      const task = this.getById(taskId);
      if (!task || task.status !== 'dispatched' || !task.sessionId) continue;

      // If session manager already confirmed idle/waiting, complete
      // immediately — the 2s polling interval means the session has been
      // idle long enough to rule out mid-skill transitions.
      const session = this.sessionManager.get(task.sessionId);
      const sessionConfirmed = state.hasStarted &&
        (session?.status === 'idle' || session?.status === 'waiting');

      if (sessionConfirmed) {
        // Plan mode tasks in 'waiting' still need the user-choice menu check —
        // a bare 'waiting' status could be a permission prompt, not completion.
        if (session?.status === 'waiting' && task.planModeAction) {
          const buffer = this.ptyManager.getReplayData(task.sessionId);
          if (!buffer || !isAtUserChoice(buffer.slice(-500))) continue;
        }
        logger.info('task', 'Session confirmed idle via fallback polling, completing task', {
          taskId,
          sessionId: task.sessionId,
        });
        state.completedViaIdle = true;
        this.completeTask(taskId);
        continue;
      }

      // Hooks not working — fall back to PTY prompt detection
      const lastDataAt = this.ptyManager.getLastDataAt(task.sessionId);
      if (lastDataAt === 0) continue;
      if (now - lastDataAt < PROMPT_QUIESCENCE_MS) continue;

      const buffer = this.ptyManager.getReplayData(task.sessionId);
      if (!buffer) continue;

      const bufferTail = buffer.slice(-2000);
      const atIdlePrompt = isAtClaudePrompt(bufferTail);

      // Plan mode tasks also complete when Claude re-enters a user-choice menu
      // (e.g. "Revise" caused Claude to re-plan and show a new menu).
      const atNewMenu = task.planModeAction && isAtUserChoice(bufferTail.slice(-500));

      if (!atIdlePrompt && !atNewMenu) continue;

      logger.info('task', 'Prompt detected via fallback polling, completing task', {
        taskId,
        sessionId: task.sessionId,
        completedVia: atIdlePrompt ? 'idle-prompt' : 'new-user-choice',
      });

      // Ensure session status reflects current state
      if (atIdlePrompt) {
        this.sessionManager.updateStatus(task.sessionId, 'idle');
      }

      state.completedViaIdle = true;
      this.completeTask(taskId);
    }
  }

  private completeTask(taskId: number): void {
    const state = this.dispatchStates.get(taskId);
    if (state?.idleTimer) clearTimeout(state.idleTimer);

    const db = getDb();
    db.prepare(
      `UPDATE task_queue SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'dispatched'`,
    ).run(new Date().toISOString(), taskId);

    this.dispatchStates.delete(taskId);

    logger.info('task', 'Task completed', { taskId });

    const task = this.getById(taskId);
    if (task) this.broadcastChange({ type: 'upsert', task });

    this.dispatchPending();

    // Auto-close: if the session has autoClose=true and the queue is now empty,
    // schedule a kill after a short debounce to avoid closing on rapid re-enqueue.
    // Use sessionId as fallback for new-session tasks (targetSessionId is null).
    const sessionIdForAutoClose = task?.targetSessionId ?? task?.sessionId;
    if (sessionIdForAutoClose) {
      this.maybeScheduleAutoClose(sessionIdForAutoClose);
    }
  }

  private maybeScheduleAutoClose(sessionId: string): void {
    const session = this.sessionManager.get(sessionId);
    if (!session?.autoClose || session.status === 'ended') return;

    setTimeout(() => {
      const current = this.sessionManager.get(sessionId);
      if (!current?.autoClose || current.status === 'ended') return;

      const db = getDb();
      const row = db.prepare(
        `SELECT COUNT(*) as cnt FROM task_queue
         WHERE status IN ('pending','dispatched')
           AND (session_id = ? OR target_session_id = ?)`,
      ).get(sessionId, sessionId) as { cnt: number };

      if (row.cnt === 0 && current.status === 'idle') {
        logger.info('task', 'Auto-closing session (queue drained)', { sessionId });
        this.sessionManager.kill(sessionId).catch(() => {});
      }
    }, 500);
  }

  private failTask(taskId: number, error: string, permanent = false): void {
    const state = this.dispatchStates.get(taskId);
    if (state?.idleTimer) clearTimeout(state.idleTimer);

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

export function registerTaskIpc(taskQueue: TaskQueue): void {
  typedHandle('task:create', (input) => {
    return taskQueue.create(input);
  });

  typedHandle('task:list', (filter) => {
    return taskQueue.list(filter);
  });

  typedHandle('task:update', (taskId, input) => {
    return taskQueue.update(taskId, input);
  });

  typedHandle('task:cancel', (taskId) => {
    taskQueue.cancel(taskId);
  });

  typedHandle('task:reorder', (taskId, direction) => {
    return taskQueue.reorder(taskId, direction);
  });
}
