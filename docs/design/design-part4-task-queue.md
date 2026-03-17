# mcode — Part 4: Task Queue

> **Phases covered:** 7 (Task Queue)
> **Prerequisites:** Part 3 complete (hooks, attention system, full session state machine)
> **Outcome:** Queue prompts for async dispatch to sessions, concurrency control, scheduled tasks
> **Reference:** See `design-v1.md` for full architecture

---

## Architecture Context

### Task Queue (`task-queue.ts`)

Manages a queue of prompts to be dispatched to Claude Code sessions.

```typescript
interface Task {
  id: number;
  prompt: string;
  cwd: string;
  sessionId: string | null;            // set on dispatch — the session that ran this task
  status: 'pending' | 'dispatched' | 'completed' | 'failed';
  priority: number;                    // Higher = more urgent
  scheduledAt: Date | null;            // null = dispatch ASAP
  createdAt: Date;
  dispatchedAt: Date | null;
  completedAt: Date | null;
  retryCount: number;                  // incremented on each failed attempt
  maxRetries: number;                  // default 3; task marked 'failed' only after exhausting retries
  error: string | null;               // Failure reason if status='failed'
}
```

**Design decision — always fresh session:** Every task spawns a new Claude Code session.
Tasks never reuse an existing session's context. This avoids context bleed between
unrelated tasks and simplifies dispatch (no need to track session idle state).
If a user wants to send follow-up work to an existing session, they interact with
that session directly — not through the queue.

**Dispatch logic:**
1. Poll pending tasks every 2 seconds (or react to session status changes)
2. For each pending task (if under concurrency limit):
   - Spawn a new Claude Code session with `claude "task prompt"` (positional argument)
   - Set `session_id` to the newly created session ID
   - Mark as `dispatched`
3. If max concurrent sessions limit reached, keep task `pending` (retry next cycle)
4. **Completion detection:** Subscribe to session status changes. When the task's `session_id` transitions to `idle` or `ended` after being `active`, mark the task `completed`.
5. **Retry on failure:** If spawn fails, increment `retry_count`. If `retry_count < max_retries`, reset status to `pending` for next cycle. Otherwise mark `failed`.
6. Scheduled tasks (with `scheduledAt`) are held until the scheduled time

**Concurrency control:**
- Configurable max concurrent sessions (default: 5)
- Respects system resources — surfaces memory/CPU warnings if too many PTYs

### Database Additions

```sql
CREATE TABLE task_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
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
```

### IPC Bridge Additions

```typescript
interface MCodeAPI {
  // ... pty, sessions, hooks, layout, app (from Parts 1-3)

  tasks: {
    create(task: CreateTaskInput): Promise<number>;
    list(filter?: TaskFilter): Promise<Task[]>;
    cancel(taskId: number): Promise<void>;
    onUpdate(callback: (task: Task) => void): () => void;
  };
}
```

### Task Store

```typescript
interface TaskState {
  tasks: Task[];

  addTask(prompt: string, cwd: string): Promise<void>;
  cancelTask(taskId: number): Promise<void>;
  refreshTasks(): Promise<void>;
}
```

### Task Dispatch Data Flow

```
User creates task (prompt, cwd)
  │
  ▼
Renderer ──IPC──► Main: taskQueue.create()
  │                  │
  │                  ├─ INSERT into task_queue table
  │                  └─ Trigger dispatch check
  │
  │                  Dispatch loop (every 2s or on session status change):
  │                  │
  │                  ├─ Query: SELECT * FROM task_queue
  │                  │         WHERE status='pending'
  │                  │         AND (scheduled_at IS NULL OR scheduled_at <= now)
  │                  │         ORDER BY priority DESC, created_at
  │                  │
  │                  ├─ For each pending task (if under concurrency limit):
  │                  │   └─ sessionManager.create({ cwd, prompt })
  │                  │       → spawns new Claude session
  │                  │
  │                  └─ UPDATE task_queue SET status='dispatched',
  │                     session_id=<new session id>
  │
  │                  Completion listener (on session status change):
  │                  │
  │                  ├─ Look up dispatched task by session_id
  │                  └─ If session is idle/ended → mark task completed
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
│       ├── Session link (once dispatched, click to focus)
│       └── Cancel button (pending only)
└── SidebarFooter
```

### Error Handling

| Component | Failure | Recovery |
|---|---|---|
| **Task dispatch** | PTY spawn fails | Increment `retry_count`; if under `max_retries`, reset to `pending`; else mark `failed`. |
| **Concurrency limit** | All slots occupied | Keep task `pending`, retry next cycle (does not count as a retry). |
| **Task running** | Session goes `ended` unexpectedly while `dispatched` | Mark task `failed` with "session ended before completion". |

---

## Phase 7: Task Queue

**Goal:** Queue prompts for dispatch to sessions. This enables the async workflow: queue up work, walk away, come back to results.

**Build:**
- `task_queue` SQLite table
- `TaskQueue` class in main process: create, cancel, dispatch loop
- Dispatch logic: pending task → spawn new session with prompt (up to concurrency limit)
- Task completion detection: session transitions from dispatched task's session going `idle` or `ended`
- Sidebar `TaskQueuePanel`: list of pending/dispatched/completed tasks
- "New Task" dialog: prompt text, cwd
- Scheduled tasks (dispatch after a given time)

**Verify:**
1. Create a task → new session spawns, prompt dispatched
2. Create 3 tasks with max concurrency set to 2 → two dispatch immediately, third waits
3. When a dispatched session finishes and a slot opens → queued task dispatches
5. Cancel a pending task → it disappears from queue, never dispatches
6. Create a task scheduled for 1 minute from now → it stays "pending" until the time, then dispatches
7. Task panel shows status progression: pending → dispatched → completed

**Files created:** `src/main/task-queue.ts`, `db/migrations/004_task_queue.sql`, `src/renderer/components/Sidebar/TaskQueuePanel.tsx`, `src/renderer/stores/task-store.ts`
**Files modified:** `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/components/Sidebar/Sidebar.tsx`
