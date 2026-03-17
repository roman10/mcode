# mcode — Part 4: Task Queue

> **Phases covered:** 7 (Task Queue)
> **Prerequisites:** Part 3 complete (hooks, attention system, full session state machine)
> **Outcome:** Queue prompts for async dispatch to sessions, concurrency control, scheduled tasks
> **Reference:** See `design-v1.md` for full architecture

---

## Architecture Context

### Task Queue (`task-queue.ts`)

Manages a queue of prompts to be dispatched to Claude Code sessions.
Phase 7 task queueing is supported only for Claude sessions in live hook mode.

```typescript
interface Task {
  id: number;
  prompt: string;
  cwd: string;
  targetSessionId: string | null;      // null = spawn new session; set = send to existing session
  sessionId: string | null;            // set on dispatch — the session that actually ran this task
  status: 'pending' | 'dispatched' | 'completed' | 'failed';
  priority: number;                    // Higher = more urgent
  scheduledAt: string | null;          // ISO 8601; null = dispatch ASAP
  createdAt: string;                   // ISO 8601
  dispatchedAt: string | null;
  completedAt: string | null;
  retryCount: number;                  // incremented on each failed attempt
  maxRetries: number;                  // default 3; task marked 'failed' only after exhausting retries
  error: string | null;               // Failure reason if status='failed'
}

interface CreateTaskInput {
  prompt: string;
  cwd: string;
  targetSessionId?: string;
  priority?: number;
  scheduledAt?: string;               // ISO 8601
  maxRetries?: number;
}

interface TaskFilter {
  statuses?: Array<'pending' | 'dispatched' | 'completed' | 'failed'>;
  targetSessionId?: string;
  limit?: number;
}

type TaskChangeEvent =
  | { type: 'upsert'; task: Task }
  | { type: 'remove'; taskId: number };
```

**Eligibility and hook requirements:**
- Task queue dispatch requires the hook runtime to be `ready`. If the hook subsystem is `degraded`,
  task creation is rejected with a retryable error and the TaskQueuePanel shows an unavailable state.
- Existing-session tasks are valid only for Claude sessions with `hookMode = 'live'`.
  Targeting terminal sessions, ended sessions, or fallback-mode Claude sessions is rejected at create time.
- New-session tasks always create Claude sessions through `SessionManager.create(...)`; they never spawn PTYs directly.
- If hook runtime becomes unusable during execution, no new tasks dispatch until runtime returns to `ready`.

**Two dispatch modes:**
- **`targetSessionId = null`** — spawn a fresh Claude session with the prompt as a positional arg.
  Each task gets its own clean context.
- **`targetSessionId = <id>`** — send the prompt to an existing session's PTY stdin when that session
  becomes `idle`. The task inherits the session's full conversation history (intentional — this is
  for follow-up work like "now write tests for what you just built").

**Multiple tasks on the same session** are dispatched sequentially: only one task per session can be
`dispatched` at a time. When it completes (session goes `idle`), the next pending task targeting
that session is dispatched. Tasks are ordered by `priority DESC, created_at ASC` within a session.

**Runtime tracking for dispatched tasks:** TaskQueue keeps in-memory dispatch state per task:
- `hasStarted`: false at dispatch time; becomes true when the dispatched session transitions to `active`
- `completedViaIdle`: false at dispatch time; becomes true when the dispatched session reaches `idle`

Completion rules use this runtime state so a task sent to an already-idle session is not immediately
marked complete before Claude begins working on it.

**Dispatch logic:**
1. Poll pending tasks every 2 seconds (or react to session status changes)
2. For each pending task (respecting `scheduled_at`):
   - Skip if hook runtime is not `ready`
   - **If `target_session_id` is set (existing session):**
     - Skip if another task targeting this session is already `dispatched` (one-at-a-time per session)
     - Skip if the target session is not `idle`
     - Write the prompt to the session's PTY stdin (`pty.write(id, prompt + '\n')`)
     - Set `session_id = target_session_id`, mark `dispatched`
   - **If `target_session_id` is null (new session):**
     - Skip if at max concurrent sessions limit
     - Spawn new session via `sessionManager.create({ cwd, initialPrompt: prompt })`
     - Set `session_id` to the new session ID, mark `dispatched`
3. **Completion detection:** Subscribe to main-process session status changes. When a dispatched
   task's session transitions to `active`, set `hasStarted = true`. When a session transitions
   to `idle` after `hasStarted = true`:
   - Look up the `dispatched` task for that `session_id`
   - Mark it `completed`
   - Set `completedViaIdle = true`
   - This naturally triggers the next pending task for that session on the next dispatch cycle
   When a session transitions to `ended`:
   - If `completedViaIdle = true` → `completed`
   - Otherwise → `failed` with "session ended before completion"
4. **Retry on failure:** If dispatch fails (PTY spawn error, target session gone/ended),
   increment `retry_count`. If under `max_retries`, reset to `pending`. Otherwise mark `failed`.
5. Scheduled tasks (with `scheduledAt`) are held until the scheduled time

**Concurrency control:**
- Phase 7 uses a `maxConcurrentSessions` constructor option on `TaskQueue` with a default of 5.
  Settings UI/configuration lands in Part 5; tests may override the constructor value.
- Respects system resources — surfaces memory/CPU warnings if too many PTYs

**Startup reconciliation:**
- On app startup, any task left in `dispatched` state from a previous run is marked `failed`
  with error `app restarted during task execution`.
- Pending scheduled tasks remain pending.
- Pending unscheduled tasks are eligible for dispatch immediately after reconciliation.

**Main-process integration requirement:**
- `TaskQueue` uses `SessionManager.create(...)` for new sessions.
- `TaskQueue` must subscribe to session updates inside the main process, not via renderer IPC.
  `SessionManager` therefore exposes a main-process listener API such as
  `onSessionUpdated(listener: (session: SessionInfo, previousStatus: SessionStatus | null) => void): () => void`.
  Renderer IPC broadcasts remain unchanged and are not used for TaskQueue coordination.

### Database Additions

```sql
CREATE TABLE task_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  target_session_id TEXT,                -- null = spawn new; set = send to existing session
  session_id TEXT,                        -- set on dispatch; correlates task ↔ session
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 0,   -- Higher = more urgent
  scheduled_at TEXT,
  dispatched_at TEXT,
  completed_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  error TEXT,                            -- Failure reason if status='failed'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_task_queue_status ON task_queue(status, priority DESC, created_at);
CREATE INDEX idx_task_queue_session ON task_queue(session_id)
  WHERE status = 'dispatched';
CREATE INDEX idx_task_queue_target ON task_queue(target_session_id, status, priority DESC, created_at)
  WHERE target_session_id IS NOT NULL;
```

### IPC Bridge Additions

```typescript
interface MCodeAPI {
  // ... pty, sessions, hooks, layout, app (from Parts 1-3)

  tasks: {
    create(task: CreateTaskInput): Promise<number>;
    list(filter?: TaskFilter): Promise<Task[]>;
    cancel(taskId: number): Promise<void>;
    onChanged(callback: (event: TaskChangeEvent) => void): () => void;
  };
}
```

**Cancellation semantics:**
- `cancel(taskId)` is valid only for `pending` tasks.
- Cancel physically deletes the row from `task_queue`.
- Cancellation emits `{ type: 'remove', taskId }` through `onChanged(...)`.
- Cancelling `dispatched`, `completed`, or `failed` tasks returns an error.

### Task Store

```typescript
interface TaskState {
  tasks: Task[];

  addTask(input: CreateTaskInput): Promise<number>;
  cancelTask(taskId: number): Promise<void>;
  refreshTasks(filter?: TaskFilter): Promise<void>;
}
```

### Task Dispatch Data Flow

```
User creates task (prompt, cwd, optional targetSessionId)
  │
  ▼
Renderer ──IPC──► Main: taskQueue.create()
  │                  │
  │                  ├─ INSERT into task_queue table
  │                  └─ Trigger dispatch check
  │
  │                  Dispatch loop (every 2s or on session status change):
  │                  │
  │                  ├─ Query pending tasks (scheduled_at respected)
  │                  │   ORDER BY priority DESC, created_at
  │                  │
  │                  ├─ For each pending task:
  │                  │   ├─ If target_session_id is set:
  │                  │   │   ├─ Skip if another task on this session is dispatched
  │                  │   │   ├─ Skip if session is not idle
  │                  │   │   └─ pty.write(target_session_id, prompt + '\n')
  │                  │   │       → session_id = target_session_id
  │                  │   │
  │                  │   └─ If target_session_id is null:
  │                  │       ├─ Skip if at concurrency limit
  │                  │       └─ sessionManager.create({ cwd, initialPrompt: prompt })
  │                  │           → session_id = new session id
  │                  │
  │                  └─ UPDATE task SET status='dispatched', session_id=...
  │
  │                  Completion listener (on session status change):
  │                  │
  │                  ├─ Session goes idle → mark dispatched task completed
  │                  │   → next pending task for this session dispatches next cycle
  │                  └─ Session ends → completed if was idle, else failed
  │
  ◄──────── IPC: task status update ─────────┘
```

### Component: TaskQueuePanel

Added to the sidebar below the session list:

```
Sidebar
├── AppHeader
├── SessionList
│   └── SessionCard × N
├── TaskQueuePanel              ← new
│   ├── "New Task" button
│   └── TaskItem × N
│       ├── Prompt preview (truncated)
│       ├── Status badge (pending/dispatched/completed/failed)
│       ├── Target: session label (or "New session")
│       └── Cancel button (pending only)
```

**Queued tasks on a session:** When multiple tasks target the same session, the TaskQueuePanel
groups them visually under that session. The currently dispatched task shows "running", the
rest show "queued". This makes it clear that tasks will execute sequentially on that session.

**Unavailable state:** If hook runtime is `degraded`, the panel remains visible but disables
new task creation and shows a compact message: `Task queue requires live hook mode`.

```
└── SidebarFooter
```

### Devtools / MCP Surface

Part 7 must be verifiable through MCP, consistent with the project rule that new features are
automatable.

`McpServerContext` (in `src/devtools/types.ts`) must gain a `taskQueue: TaskQueue` field so tools can access the task queue.

Required devtools tools:

```typescript
task_create(input: CreateTaskInput): Task
task_list(filter?: TaskFilter): Task[]
task_cancel(taskId: number): void
task_wait_for_status(taskId: number, status: Task['status'], timeout_ms?: number): Task
sidebar_get_tasks(): Task[]
```

Test helpers should wrap these tools, and a dedicated integration suite should cover:
- new-session dispatch
- existing-session sequential dispatch
- concurrency limit enforcement
- cancellation
- scheduled execution
- degraded-mode rejection
- startup reconciliation of stranded `dispatched` tasks

### Error Handling

| Component | Failure | Recovery |
|---|---|---|
| **Task create** | Hook runtime is `degraded` | Reject create with retryable error: `Task queue requires live hook mode`. |
| **Task create** | Target session is terminal, fallback-mode Claude, or `ended` | Reject create with validation error. |
| **Task dispatch** | PTY spawn fails | Increment `retry_count`; if under `max_retries`, reset to `pending`; else mark `failed`. |
| **Task dispatch** | Target session no longer exists or `ended` | Increment `retry_count`; if under `max_retries`, reset to `pending`; else mark `failed`. |
| **Concurrency limit** | All slots occupied | Keep task `pending`, retry next cycle (does not count as a retry). |
| **Per-session queue** | Another task already dispatched on target session | Keep task `pending`, dispatch after current task completes (does not count as a retry). |
| **Task running** | Session goes `ended` unexpectedly while `dispatched` | Mark task `failed` with "session ended before completion". Also fail all remaining pending tasks targeting that session. |
| **App restart** | Task was `dispatched` when app last exited | Mark `failed` during startup reconciliation. |

---

## Phase 7: Task Queue

**Goal:** Queue prompts for dispatch to sessions. This enables the async workflow: queue up work, walk away, come back to results.

**Build:**
- `task_queue` SQLite table (with `target_session_id` + `session_id`)
- `TaskQueue` class in main process: create, cancel, startup reconciliation, dispatch loop
- Dispatch logic: two paths — new session (spawn) vs existing session (write to PTY when idle)
- Per-session sequential dispatch: only one dispatched task per session at a time
- Live-hook-only eligibility rules for all queued tasks
- Task completion detection: session transitions `active -> idle` or `ended`, tracked per dispatch
- Cascade failure: when a session ends, fail all remaining pending tasks targeting it
- Main-process session subscription API for TaskQueue coordination
- Sidebar `TaskQueuePanel`: list of tasks, grouped by target session when applicable
- "New Task" dialog: prompt text, cwd, optional target session picker
- Scheduled tasks (dispatch after a given time)
- MCP/devtools tools for task automation and verification

**Verify:**
1. Create a task with no target → new session spawns, prompt dispatched
2. Create a task targeting an idle session → prompt appears in the terminal
3. Queue 3 tasks on the same session → they execute sequentially (one at a time)
4. Create 3 new-session tasks with max concurrency=2 → two dispatch, third waits
5. When a dispatched session finishes and a slot opens → pending task dispatches
6. Cancel a pending task → it disappears from queue, never dispatches
7. Create a task scheduled for 1 minute from now → stays pending, then dispatches
8. Task panel shows status progression: pending → dispatched → completed
9. Target session ends while tasks are queued → dispatched task fails, remaining pending tasks fail
10. Create a task while hook runtime is `degraded` → request is rejected and panel shows unavailable state
11. Restart the app with a task stuck in `dispatched` → task becomes `failed` with restart error
12. Verify all scenarios through MCP tools without manual UI interaction

**Files created:** `src/main/task-queue.ts`, `db/migrations/004_task_queue.sql`, `src/renderer/components/Sidebar/TaskQueuePanel.tsx`, `src/renderer/stores/task-store.ts`
**Files modified:** `src/main/index.ts`, `src/main/session-manager.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/components/Sidebar/Sidebar.tsx`, `src/devtools/mcp-server.ts`, `src/devtools/types.ts`, `tests/helpers.ts`
**Files added for verification:** `src/devtools/tools/task-tools.ts`, `tests/suites/task-queue.test.ts`
