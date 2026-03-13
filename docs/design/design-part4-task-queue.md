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
  targetSessionId: string | null;  // null = create new session
  status: 'pending' | 'dispatched' | 'completed' | 'failed';
  priority: number;                // Higher = more urgent
  scheduledAt: Date | null;        // null = dispatch ASAP
  createdAt: Date;
  dispatchedAt: Date | null;
  completedAt: Date | null;
  error: string | null;           // Failure reason if status='failed'
}
```

**Dispatch logic:**
1. Poll pending tasks every 2 seconds (or react to session status changes)
2. For tasks targeting an existing session:
   - Wait until that session is `idle`
   - Write the prompt to the PTY stdin
3. For tasks targeting a new session:
   - Spawn a new PTY with `claude "task prompt"` (positional argument)
   - If max concurrent sessions limit reached, keep in queue
4. Mark as `dispatched` when sent, `completed` when session reaches `idle` or `ended` after dispatch
5. Scheduled tasks (with `scheduledAt`) are held until the scheduled time

**Concurrency control:**
- Configurable max concurrent sessions (default: 5)
- Respects system resources — surfaces memory/CPU warnings if too many PTYs

### Database Additions

```sql
CREATE TABLE task_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT NOT NULL,
  cwd TEXT,
  target_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 0,   -- Higher = more urgent
  scheduled_at TEXT,
  dispatched_at TEXT,
  completed_at TEXT,
  error TEXT,                            -- Failure reason if status='failed'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_task_queue_status ON task_queue(status, priority DESC, created_at);
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

  addTask(prompt: string, cwd: string, targetSessionId?: string): Promise<void>;
  cancelTask(taskId: number): Promise<void>;
  refreshTasks(): Promise<void>;
}
```

### Task Dispatch Data Flow

```
User creates task (prompt, cwd, optional target session)
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
  │                  ├─ For each pending task:
  │                  │   ├─ If target_session_id set AND session is idle:
  │                  │   │   └─ pty.write(target_session_id, prompt + Enter)
  │                  │   ├─ If target_session_id is NULL AND under concurrency limit:
  │                  │   │   └─ pty.spawn(new session with prompt as positional arg)
  │                  │   └─ Else: skip (retry next cycle)
  │                  │
  │                  └─ UPDATE task_queue SET status='dispatched'
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
│       ├── Target session label (or "New session")
│       └── Cancel button (pending only)
└── SidebarFooter
```

### Error Handling

| Component | Failure | Recovery |
|---|---|---|
| **Task dispatch** | Target session no longer exists | Mark task as `failed` with reason. |
| **Task dispatch** | PTY spawn fails | Mark task as `failed`, log error. |
| **Concurrency limit** | All slots occupied | Keep task `pending`, retry next cycle. |

---

## Phase 7: Task Queue

**Goal:** Queue prompts for dispatch to sessions. This enables the async workflow: queue up work, walk away, come back to results.

**Build:**
- `task_queue` SQLite table
- `TaskQueue` class in main process: create, cancel, dispatch loop
- Dispatch logic: pending task + idle target session → write prompt to PTY; pending task + no target → spawn new session (up to concurrency limit)
- Task completion detection: session transitions from dispatched task's session going `idle` or `ended`
- Sidebar `TaskQueuePanel`: list of pending/dispatched/completed tasks
- "New Task" dialog: prompt text, cwd, optional target session
- Scheduled tasks (dispatch after a given time)

**Verify:**
1. Create a task targeting an idle session → prompt appears in the terminal within 2 seconds
2. Create a task with no target session → new session spawns, prompt dispatched
3. Create 3 tasks with max concurrency set to 2 → two dispatch immediately, third waits
4. When a session finishes → queued task dispatches to it
5. Cancel a pending task → it disappears from queue, never dispatches
6. Create a task scheduled for 1 minute from now → it stays "pending" until the time, then dispatches
7. Task panel shows status progression: pending → dispatched → completed

**Files created:** `src/main/task-queue.ts`, `db/migrations/003_task_queue.sql`, `src/renderer/components/Sidebar/TaskQueuePanel.tsx`, `src/renderer/stores/task-store.ts`
**Files modified:** `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/components/Sidebar/Sidebar.tsx`
