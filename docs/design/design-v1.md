# mcode — Design Document v1

## Overview

mcode is a desktop IDE for managing multiple autonomous Claude Code sessions simultaneously. It provides a tiling window manager interface where each tile is a fully interactive terminal running a Claude Code session, with a control panel that aggregates real-time status from all sessions and highlights those requiring human attention.

This document details the architecture, component design, data flows, and implementation plan for the Electron + React/TypeScript stack.

---

## 1. Project Structure

```
mcode/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
│
├── resources/                    # App icons, platform assets
│   └── icon.icns
│
├── src/
│   ├── shared/                   # Types & constants shared across all processes
│   │   ├── types.ts              # SessionInfo, HookEvent, Task, IPC channel types
│   │   └── constants.ts          # Status enums, default config values
│   │
│   ├── main/                     # Electron main process
│   │   ├── index.ts              # App entry, window creation, top-level wiring
│   │   ├── pty-manager.ts        # PTY lifecycle + its own IPC handlers
│   │   ├── session-manager.ts    # Session state machine + its own IPC handlers
│   │   ├── task-queue.ts         # Task queue, scheduling, dispatch + IPC handlers
│   │   ├── hook-server.ts        # HTTP server receiving Claude Code hook events
│   │   ├── hook-config.ts        # Manages ~/.claude/settings.json hook entries
│   │   ├── db.ts                 # better-sqlite3 setup, migrations, queries
│   │   └── logger.ts             # Structured logging (electron-log or pino)
│   │
│   ├── preload/                  # Electron preload scripts
│   │   └── index.ts              # contextBridge API exposure
│   │
│   └── renderer/                 # React frontend (Vite-bundled)
│       ├── index.html
│       ├── main.tsx              # React entry
│       ├── App.tsx               # Root layout: sidebar + mosaic
│       │
│       ├── stores/               # Zustand state management
│       │   ├── session-store.ts  # Session list, statuses, selection
│       │   ├── layout-store.ts   # Mosaic tree state, persistence
│       │   └── task-store.ts     # Task queue UI state
│       │
│       ├── components/
│       │   ├── Sidebar/
│       │   │   ├── Sidebar.tsx           # Container: session list + task queue
│       │   │   ├── SessionCard.tsx       # Individual session: name, status, actions
│       │   │   ├── SessionList.tsx       # Scrollable session list
│       │   │   └── TaskQueuePanel.tsx    # Pending/dispatched tasks
│       │   │
│       │   ├── Terminal/
│       │   │   ├── TerminalTile.tsx      # Mosaic tile wrapper for a terminal
│       │   │   ├── TerminalInstance.tsx  # xterm.js lifecycle (attach, resize, dispose)
│       │   │   └── TerminalToolbar.tsx   # Per-terminal header: session name, status badge
│       │   │
│       │   ├── Layout/
│       │   │   ├── MosaicLayout.tsx      # react-mosaic root, drag/drop, persistence
│       │   │   └── TileFactory.tsx       # Maps tile IDs to terminal or dashboard components
│       │   │
│       │   └── Dashboard/
│       │       ├── ControlPanel.tsx      # Aggregate view of all session statuses
│       │       └── ActivityFeed.tsx      # Real-time event stream from hook server
│       │
│       └── styles/
│           ├── global.css        # Tailwind v4 CSS entry (@import "tailwindcss", @theme tokens) + xterm.js / mosaic overrides
│           └── theme.ts          # Color tokens, dark theme
│
├── db/
│   └── migrations/
│       └── 001_initial.sql       # Initial schema
│
└── scripts/
    └── dev.ts                    # Dev startup helpers
```

**Key structural decisions:**
- **`src/shared/`** — Types and constants importable by main, preload, and renderer. Avoids duplication and keeps IPC contracts in sync.
- **IPC handlers co-located with domain modules** — Each module (pty-manager, session-manager, task-queue) registers its own IPC handlers in an `init(mainWindow)` function called from `index.ts`. No monolithic `ipc-handlers.ts` to become a dumping ground.
- **Tailwind CSS v4** — Utility-first, zero runtime CSS. Uses `@tailwindcss/vite` plugin and CSS-based configuration (`@theme` directives in `global.css`), no JS config file needed. Works well for rapid iteration on a dark-themed UI.
- **Structured logging** — `logger.ts` wraps `electron-log` to write structured logs to `~/Library/Logs/mcode/`. Critical for debugging PTY and hook issues post-hoc.

---

## 2. Main Process Architecture

### 2.1 PTY Manager (`pty-manager.ts`)

Responsible for spawning, managing, and destroying PTY processes. Each PTY corresponds to one Claude Code session terminal.

```typescript
interface PtyHandle {
  id: string;                    // UUID, matches session_id
  process: IPty;                 // node-pty process
  cols: number;
  rows: number;
}

class PtyManager {
  private ptys: Map<string, PtyHandle>;

  // Spawn a new PTY running `claude` CLI
  spawn(options: {
    id: string;
    cwd: string;
    cols: number;
    rows: number;
    args?: string[];             // e.g. ["--resume", sessionId] or [taskPrompt] (positional arg)
    env?: Record<string, string>;
    permissionMode?: string;     // e.g. "plan", "default", "dontAsk", "acceptEdits", "auto"
  }): PtyHandle;

  // Write user input to PTY stdin
  write(id: string, data: string): void;

  // Resize PTY (triggered by xterm.js fit addon)
  resize(id: string, cols: number, rows: number): void;

  // Gracefully kill PTY (SIGTERM, then SIGKILL after timeout)
  kill(id: string): Promise<void>;

  // Get all active PTY IDs
  list(): string[];
}
```

**Key behaviors:**
- Spawns `claude` with the user's default shell environment so SSH keys, PATH, and tool configs work
- Sets `MCODE_SESSION_ID=<internal_uuid>` in the PTY environment — Claude Code inherits this env var, and the HTTP hook config uses `allowedEnvVars` + `headers` to forward it as `X-Mcode-Session-Id` header to the hook server, enabling correlation with Claude Code's own `session_id` (see §2.3)
- Listens to `process.onData` and forwards output to renderer via IPC
- Listens to `process.onExit` and updates session status
- PTY output is buffered (ring buffer, ~100KB per session) so that when a tile is re-mounted in the mosaic, recent output can be replayed without re-reading from disk

**IPC channels (main → renderer):**
- `pty:data` — terminal output bytes
- `pty:exit` — process exit code/signal

**IPC channels (renderer → main):**
- `pty:spawn` — create new PTY
- `pty:write` — send keystrokes
- `pty:resize` — update dimensions
- `pty:kill` — terminate session

### 2.2 Session Manager (`session-manager.ts`)

Manages the lifecycle state machine for each Claude Code session. Coordinates between PTY events and hook events to maintain accurate session status.

**Session state machine:**

```
                  ┌─────────────────────────────┐
                  │                             │
  spawn ──► STARTING ──► ACTIVE ──► IDLE ──► ENDED
                           │  ▲       │
                           │  │       │
                           ▼  │       │
                        WAITING ──────┘
                    (needs human input)
```

| State | Trigger | Description |
|-------|---------|-------------|
| `starting` | PTY spawned | Claude Code is initializing |
| `active` | `SessionStart` hook or PTY output detected | Agent is working |
| `idle` | `Stop` hook (fires when Claude finishes responding; payload has `stop_hook_active` and `last_assistant_message`) | Agent finished current task, waiting for input |
| `waiting` | `PermissionRequest` hook (fires when permission dialog appears) or `Notification` hook | Needs human approval or attention |
| `ended` | PTY exit or `SessionEnd` hook | Session terminated |

**Session metadata tracked in memory and persisted to SQLite:**
- `session_id` — UUID assigned at spawn time
- `claude_session_id` — The session ID reported by Claude Code via hooks (may differ)
- `cwd` — Working directory
- `status` — Current state
- `label` — User-assigned name (defaults to cwd basename)
- `last_tool` — Last tool used (from `PostToolUse`)
- `last_event_at` — Timestamp of most recent hook event
- `attention_reason` — Why this session needs attention (null if it doesn't)

### 2.3 Hook Server (`hook-server.ts`)

A lightweight HTTP server (Node.js `http` module, no framework) running on `localhost:7777` that receives Claude Code hook POST requests.

**Request handling:**

```
POST /hook
Content-Type: application/json

{
  "session_id": "abc-123",
  "type": "PostToolUse",        // hook event name
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "cwd": "/Users/feipeng/project",
  ...
}
```

**Processing pipeline:**

1. Parse JSON body
2. Map `session_id` from hook payload to internal session (create mapping on first `SessionStart`)
3. Persist raw event to `events` table
4. Update session state via Session Manager
5. Emit event to renderer via IPC (`hook:event`)
6. Return `200 OK` (or `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow|deny", "permissionDecisionReason": "..."}}` for `PreToolUse` hooks when auto-approval rules are configured)

**PreToolUse decision engine (future):**
- Users can configure rules like "auto-approve Read in /src" or "deny Bash commands containing rm -rf"
- Rules stored in SQLite, evaluated on each `PreToolUse` event
- Decision format: `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow|deny|ask", "permissionDecisionReason": "reason"}}`
- Default: return plain `200 OK` with no body (pass through), letting Claude Code's own permission system handle it

**Hook configuration strategy:**

Claude Code hooks are configured in `~/.claude/settings.json` using a structured format. mcode must manage this config:

1. On first launch, read existing `~/.claude/settings.json`
2. Merge mcode's hook entries into the `hooks` object. Each event type maps to an array of `{ matcher?, hooks: [{ type: "http", url, headers, allowedEnvVars, timeout }] }` objects. Example for a single event:
   ```json
   {
     "hooks": {
       "PreToolUse": [
         { "hooks": [{ "type": "http", "url": "http://localhost:7777/hook", "headers": { "X-Mcode-Session-Id": "$MCODE_SESSION_ID" }, "allowedEnvVars": ["MCODE_SESSION_ID"] }] }
       ],
       "PostToolUse": [ ... ],
       "Stop": [ ... ],
       "PermissionRequest": [ ... ],
       "SessionStart": [ ... ],
       "SessionEnd": [ ... ],
       "Notification": [ ... ],
       "PostToolUseFailure": [ ... ]
     }
   }
   ```
   Identical hooks are auto-deduplicated by Claude Code, so appending is safe.
3. Write merged config back, preserving all existing user hooks
4. On quit, remove mcode's hook entries (leave user hooks intact)
5. Store a backup of the original settings before modification
6. Must also ensure `"allowedHttpHookUrls"` includes `"http://localhost:*"` so the HTTP hooks are permitted

This is implemented in a dedicated `hook-config.ts` module. Claude Code captures hooks at startup (snapshot), so hooks must be written to settings.json **before** any Claude Code sessions are spawned.

**Port selection:**
- Default: 7777
- On startup, check if port is in use; if so, try 7778-7799
- Store chosen port so hook config entries use the correct URL

### 2.4 Task Queue (`task-queue.ts`)

Manages a queue of prompts to be dispatched to Claude Code sessions.

```typescript
interface Task {
  id: number;
  prompt: string;
  cwd: string;
  targetSessionId: string | null;  // null = create new session
  status: 'pending' | 'dispatched' | 'completed' | 'failed';
  scheduledAt: Date | null;        // null = dispatch ASAP
  createdAt: Date;
  dispatchedAt: Date | null;
  completedAt: Date | null;
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

### 2.5 Database (`db.ts`)

Uses `better-sqlite3` for synchronous, zero-dependency SQLite access.

**Schema (expanded from tech-stack.md):**

```sql
-- Core session tracking
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,           -- Internal UUID
  claude_session_id TEXT,                -- Claude Code's own session ID (from hooks)
  label TEXT,                            -- User-assigned display name
  cwd TEXT NOT NULL,
  permission_mode TEXT,
  status TEXT NOT NULL DEFAULT 'starting',
  attention_reason TEXT,                 -- NULL or description of why attention needed
  last_tool TEXT,
  last_event_at TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Hook event log (append-only)
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  hook_event_name TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,                       -- JSON
  payload TEXT NOT NULL,                 -- Full raw JSON from hook
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE INDEX idx_events_session ON events(session_id, created_at);
CREATE INDEX idx_events_type ON events(hook_event_name);

-- Task queue
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

-- Layout persistence
CREATE TABLE layout_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), -- Singleton row
  mosaic_tree TEXT NOT NULL,              -- JSON serialization of react-mosaic tree
  sidebar_width INTEGER DEFAULT 280,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User preferences
CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Migration strategy:**
- Migrations stored as numbered SQL files in `db/migrations/`
- A `schema_version` table tracks applied migrations
- On app start, apply any pending migrations in order

**Data retention:**
- Events table grows fast; auto-prune events older than 7 days (configurable)
- Session records kept indefinitely (lightweight)
- Pruning runs on app startup and once per hour

---

## 3. Preload & IPC Bridge

### 3.1 IPC Channel Map

All communication between main and renderer goes through typed IPC channels exposed via `contextBridge`.

```typescript
// src/shared/types.ts — imported by main, preload, and renderer

interface MCodeAPI {
  // PTY operations
  pty: {
    spawn(options: PtySpawnOptions): Promise<string>;    // returns session_id
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    kill(sessionId: string): Promise<void>;
    onData(callback: (sessionId: string, data: string) => void): () => void;
    onExit(callback: (sessionId: string, code: number) => void): () => void;
  };

  // Session management
  sessions: {
    list(): Promise<SessionInfo[]>;
    get(sessionId: string): Promise<SessionInfo | null>;
    setLabel(sessionId: string, label: string): Promise<void>;
    onStatusChange(callback: (sessionId: string, status: string, reason?: string) => void): () => void;
  };

  // Hook events
  hooks: {
    onEvent(callback: (event: HookEvent) => void): () => void;
    getRecent(sessionId: string, limit?: number): Promise<HookEvent[]>;
  };

  // Task queue
  tasks: {
    create(task: CreateTaskInput): Promise<number>;
    list(filter?: TaskFilter): Promise<Task[]>;
    cancel(taskId: number): Promise<void>;
    onUpdate(callback: (task: Task) => void): () => void;
  };

  // Layout persistence
  layout: {
    save(mosaicTree: MosaicNode<string>): Promise<void>;
    load(): Promise<MosaicNode<string> | null>;
  };

  // App-level
  app: {
    getVersion(): Promise<string>;
    getPlatform(): string;
    onError(callback: (error: string) => void): () => void;
  };
}
```

### 3.2 Preload Script

```typescript
// preload/index.ts
contextBridge.exposeInMainWorld('mcode', {
  pty: {
    spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('pty:kill', id),
    onData: (cb) => {
      const handler = (_e, id, data) => cb(id, data);
      ipcRenderer.on('pty:data', handler);
      return () => ipcRenderer.removeListener('pty:data', handler);
    },
    onExit: (cb) => {
      const handler = (_e, id, code) => cb(id, code);
      ipcRenderer.on('pty:exit', handler);
      return () => ipcRenderer.removeListener('pty:exit', handler);
    },
  },
  // ... remaining channels follow same pattern
});
```

---

## 4. Renderer Architecture

### 4.1 Component Hierarchy

```
App
├── Sidebar (fixed left, resizable)
│   ├── AppHeader (logo, new session button)
│   ├── SessionList
│   │   └── SessionCard × N
│   │       ├── StatusBadge
│   │       ├── SessionLabel (editable)
│   │       └── SessionActions (kill, focus, queue task)
│   ├── TaskQueuePanel
│   │   └── TaskItem × N
│   └── SidebarFooter (settings, version)
│
└── MosaicLayout (fills remaining space)
    └── TileFactory (routes tile IDs to components)
        ├── TerminalTile (for session tiles)
        │   ├── TerminalToolbar
        │   │   ├── StatusBadge
        │   │   ├── SessionLabel
        │   │   ├── LastToolIndicator
        │   │   └── TileActions (split, maximize, close)
        │   └── TerminalInstance (xterm.js)
        │
        └── ControlPanel (optional dashboard tile)
            ├── SessionSummaryGrid
            └── ActivityFeed
```

### 4.2 Zustand Stores

**Session Store (`session-store.ts`):**

```typescript
// Zustand v5: use plain objects instead of Map/Set (not supported by default)
interface SessionState {
  sessions: Record<string, SessionInfo>;
  selectedSessionId: string | null;
  attentionSessionIds: string[];         // Sessions needing human input

  // Actions
  addSession(session: SessionInfo): void;
  updateStatus(id: string, status: SessionStatus, reason?: string): void;
  removeSession(id: string): void;
  selectSession(id: string): void;
  setLabel(id: string, label: string): void;
}
```

**Layout Store (`layout-store.ts`):**

```typescript
interface LayoutState {
  mosaicTree: MosaicNode<string> | null;
  sidebarWidth: number;

  // Actions
  setMosaicTree(tree: MosaicNode<string>): void;
  addTile(sessionId: string): void;     // Inserts tile into mosaic
  removeTile(sessionId: string): void;
  setSidebarWidth(width: number): void;
  persist(): void;                       // Save to SQLite via IPC
  restore(): Promise<void>;             // Load from SQLite via IPC
}
```

**Task Store (`task-store.ts`):**

```typescript
interface TaskState {
  tasks: Task[];

  // Actions
  addTask(prompt: string, cwd: string, targetSessionId?: string): Promise<void>;
  cancelTask(taskId: number): Promise<void>;
  refreshTasks(): Promise<void>;
}
```

### 4.3 Terminal Instance Component

The most critical renderer component — wraps xterm.js with proper lifecycle management.

```typescript
// Simplified component logic
function TerminalInstance({ sessionId }: { sessionId: string }) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);

  useEffect(() => {
    // 1. Create xterm.js Terminal
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: darkTheme,
      allowProposedApi: true,
    });

    // 2. Load addons
    const fitAddon = new FitAddon();
    const webglAddon = new WebglAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webglAddon);
    term.loadAddon(webLinksAddon);

    // 3. Mount to DOM
    term.open(termRef.current!);
    fitAddon.fit();

    // 4. Connect PTY data → xterm
    const unsubData = window.mcode.pty.onData((id, data) => {
      if (id === sessionId) term.write(data);
    });

    // 5. Connect xterm input → PTY
    term.onData((data) => {
      window.mcode.pty.write(sessionId, data);
    });

    // 6. Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      window.mcode.pty.resize(sessionId, term.cols, term.rows);
    });
    resizeObserver.observe(termRef.current!);

    xtermRef.current = term;

    // 7. Cleanup
    return () => {
      unsubData();
      resizeObserver.disconnect();
      webglAddon.dispose();
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={termRef} style={{ width: '100%', height: '100%' }} />;
}
```

**Performance considerations:**
- WebGL addon for GPU-accelerated rendering (falls back to canvas)
- `ResizeObserver` ensures terminal dimensions stay in sync with mosaic tile size
- PTY data is binary-safe (node-pty emits Buffer, serialized as base64 over IPC, decoded in renderer)
- Imports use `@xterm/xterm` (not legacy `xterm` package): `import { Terminal } from '@xterm/xterm'`, `import { FitAddon } from '@xterm/addon-fit'`, etc.
- When a terminal tile is hidden (not in current mosaic view), PTY output still buffers in main process

### 4.4 Mosaic Layout

Uses `react-mosaic-component` for VS Code-style tiling.

```typescript
function MosaicLayout() {
  const { mosaicTree, setMosaicTree, persist } = useLayoutStore();

  const handleChange = (newTree: MosaicNode<string> | null) => {
    setMosaicTree(newTree);
    // Debounced persist to SQLite
    debouncedPersist();
  };

  return (
    <Mosaic<string>
      renderTile={(id, path) => (
        <MosaicWindow<string> path={path} title="">
          <TileFactory tileId={id} />
        </MosaicWindow>
      )}
      value={mosaicTree}
      onChange={handleChange}
      className="mosaic-theme-dark"
    />
  );
}
```

**Tile ID convention:**
- Session terminals: `session:<session_id>`
- Control panel: `dashboard`
- Custom tiles (future): `custom:<type>:<id>`

**Layout operations:**
- Double-click sidebar session → add tile (or focus existing)
- Drag tile edges → resize
- Drag tile header → rearrange
- Right-click tile header → split horizontal/vertical, maximize, close
- Layout auto-saved to SQLite on every change (debounced 500ms)
- Layout restored from SQLite on app startup

### 4.5 Attention System

The core UX differentiator: surfacing which sessions need human input.

**Attention triggers (from hook events):**
| Hook Event | Condition | Attention Level | Visual Treatment |
|---|---|---|---|
| `PermissionRequest` | Any (permission dialog shown) | **High** — tool blocked | Red pulse on session card, tile border glow, dock badge |
| `Notification` | Any | **Medium** — agent wants to tell you something | Orange badge on session card |
| `Stop` | Any (Claude finished responding) | **Low** — task complete | Blue dot on session card |
| `PostToolUseFailure` | Any (tool call failed) | **Medium** — possible failure | Yellow warning icon |

**Visual treatment:**
- **Session card in sidebar:** Colored left-border + animated attention icon + sort-to-top
- **Terminal tile toolbar:** Pulsing status badge, optional border highlight
- **Dock icon:** macOS badge count of high-attention sessions (`app.dock.setBadge()`)
- **System notification:** For high-attention events when app is not focused (`new Notification()`)

**Attention dismissal:**
- Clicking on / focusing the session tile dismisses its attention state
- Bulk "mark all read" button in sidebar

---

## 5. Data Flow Diagrams

### 5.1 New Session Flow

```
User clicks "New Session" in Sidebar
  │
  ▼
Renderer: sessionStore.addSession() ──IPC──► Main: pty.spawn()
  │                                            │
  │                                            ├─ Spawns `claude` via node-pty
  │                                            ├─ Inserts row into sessions table
  │                                            └─ Returns session_id
  │
  ◄─────────────── session_id ─────────────────┘
  │
  ▼
Renderer: layoutStore.addTile(session_id)
  │
  ├─ Inserts tile into mosaic tree
  ├─ TerminalInstance mounts, creates xterm.js
  └─ xterm.js attaches to PTY data stream via IPC
```

### 5.2 Hook Event Flow

```
Claude Code (inside PTY) ──HTTP POST──► Hook Server (:7777)
                                           │
                                           ├─ Parse JSON payload
                                           ├─ Map claude session_id → internal session_id
                                           ├─ INSERT into events table
                                           ├─ SessionManager.handleEvent()
                                           │    ├─ Update session status
                                           │    ├─ Update last_tool, last_event_at
                                           │    └─ Check attention triggers
                                           │
                                           └─ IPC broadcast to renderer
                                                │
                                                ├─ sessionStore.updateStatus()
                                                ├─ Attention system evaluation
                                                └─ ActivityFeed append
```

### 5.3 Task Dispatch Flow

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
  │                  │   │   └─ pty.write(target_session_id, prompt)
  │                  │   ├─ If target_session_id is NULL AND under concurrency limit:
  │                  │   │   └─ pty.spawn(new session with --prompt)
  │                  │   └─ Else: skip (retry next cycle)
  │                  │
  │                  └─ UPDATE task_queue SET status='dispatched'
  │
  ◄──────── IPC: task status update ─────────┘
```

---

## 6. Session Resume & Persistence

### 6.1 Within a Running App

When a terminal tile is removed from the mosaic but the session is still active:
- PTY continues running in background
- Output buffered in main process ring buffer
- Session card stays in sidebar with live status
- Re-adding the tile replays buffered output to new xterm.js instance

### 6.2 Across App Restarts

On quit:
- All active PTY processes are killed (SIGTERM → SIGKILL after 3s)
- Session states updated to `ended` in SQLite
- Mosaic layout saved to SQLite

On relaunch:
- Layout restored from SQLite
- Sessions that were `active`/`idle`/`waiting` at quit time shown as `ended`
- User can resume a Claude Code session: spawns new PTY with `claude --resume <claude_session_id>`
- Resume reconstructs the session card with the previous `claude_session_id`

---

## 7. Theming & Visual Design

### 7.1 Design Language

- **Dark-first:** Dark backgrounds optimized for terminal readability
- **Minimal chrome:** Thin borders, subtle separators, focus on terminal content
- **Color semantics:** Status colors are the primary visual language

### 7.2 Color Tokens

```typescript
const theme = {
  bg: {
    primary: '#0d1117',          // Main background
    secondary: '#161b22',        // Sidebar, toolbars
    elevated: '#1c2128',         // Cards, hover states
    terminal: '#000000',         // Terminal background
  },
  border: {
    default: '#30363d',
    focus: '#58a6ff',
  },
  text: {
    primary: '#e6edf3',
    secondary: '#8b949e',
    muted: '#484f58',
  },
  status: {
    active: '#3fb950',           // Green — agent working
    idle: '#8b949e',             // Gray — waiting for input
    waiting: '#d29922',          // Amber — needs attention
    attention: '#f85149',        // Red — blocked, needs human
    ended: '#484f58',            // Dim — terminated
  },
  accent: '#58a6ff',             // Interactive elements
};
```

### 7.3 Typography

- **UI text:** Inter or system font, 13px base
- **Terminal:** JetBrains Mono, 13px, with ligatures disabled
- **Monospace in UI:** JetBrains Mono for session IDs, tool names, paths

---

## 8. Key Interactions

### 8.1 Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+N` | New session (prompts for cwd) |
| `Cmd+T` | New task in queue |
| `Cmd+1..9` | Focus session by index |
| `Cmd+]` / `Cmd+[` | Next/prev session |
| `Cmd+W` | Close current tile (PTY keeps running) |
| `Cmd+Shift+W` | Kill current session |
| `Cmd+\` | Toggle sidebar |
| `Cmd+D` | Split tile right |
| `Cmd+Shift+D` | Split tile down |
| `Cmd+Enter` | Maximize/restore current tile |
| `Cmd+K` | Quick session search/switch (command palette) |

### 8.2 Session Creation Dialog

Triggered by `Cmd+N` or the "+" button:

```
┌─────────────────────────────────────┐
│  New Session                        │
│                                     │
│  Working directory:                 │
│  ┌─────────────────────────────┐   │
│  │ /Users/feipeng/project      │   │
│  └─────────────────────────────┘   │
│  [Browse...]                        │
│                                     │
│  Label (optional):                  │
│  ┌─────────────────────────────┐   │
│  │                              │   │
│  └─────────────────────────────┘   │
│                                     │
│  Initial prompt (optional):         │
│  ┌─────────────────────────────┐   │
│  │                              │   │
│  └─────────────────────────────┘   │
│                                     │
│  Permission mode: [default ▾]        │
│                                     │
│        [Cancel]  [Create Session]   │
└─────────────────────────────────────┘
```

---

## 9. Build & Development Setup

### 9.1 Tooling

| Tool | Purpose |
|---|---|
| `electron-vite` | Unified build for main + preload + renderer |
| `vite` | Renderer bundling with HMR |
| `typescript` | Type safety across all processes |
| `electron-builder` | Package for macOS (.dmg), future Windows/Linux |
| `electron-rebuild` | Compile native modules (node-pty, better-sqlite3) for Electron's Node version |

### 9.2 Development Workflow

```bash
# Install dependencies
npm install

# Development (launches Electron with HMR for renderer)
npm run dev

# Type checking
npm run typecheck

# Build for macOS
npm run build:mac

# Package as .dmg
npm run package
```

### 9.3 `electron-vite` Config

```typescript
// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty', 'better-sqlite3'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
});
```

### 9.4 Key Dependencies

```json
{
  "dependencies": {
    "node-pty": "^1.1.0",
    "@xterm/xterm": "^6.0.0",
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/addon-webgl": "^0.19.0",
    "@xterm/addon-web-links": "^0.12.0",
    "better-sqlite3": "^12.6.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-mosaic-component": "^6.1.1",
    "zustand": "^5.0.0",
    "electron-log": "^5.4.0"
  },
  "devDependencies": {
    "electron": "^41.0.0",
    "electron-vite": "^5.0.0",
    "electron-builder": "^26.8.0",
    "@electron/rebuild": "^4.0.0",
    "typescript": "^5.9.0",
    "@vitejs/plugin-react": "^6.0.0",
    "vite": "^8.0.0",
    "tailwindcss": "^4.2.0",
    "@tailwindcss/vite": "^4.2.0"
  }
}
```

> **Note:** `react-mosaic-component` 6.1.1 should be tested with React 19 — if incompatible, pin `react`/`react-dom` to `^18.3.0`. Zustand v5 has API changes from v4 (see store code below).

---

## 10. Error Handling Strategy

Every layer has a defined failure mode and recovery path:

| Component | Failure | Recovery |
|---|---|---|
| **node-pty spawn** | `claude` not found in PATH | Show error in tile: "Claude Code not found. Install it or check your PATH." Session transitions to `ended`. |
| **node-pty spawn** | cwd doesn't exist | Show dialog before spawning. Reject with clear message. |
| **PTY crash** | Process exits unexpectedly (signal) | Session → `ended`. Show exit code/signal in tile toolbar. Offer "Restart" button. |
| **Hook server bind** | Port 7777 in use | Auto-increment to 7778-7799. If all fail, start without hooks and show warning banner: "Hook server unavailable — session status will be limited to PTY signals only." |
| **Hook server request** | Malformed JSON / unknown event | Log warning, return 400, do not crash server. |
| **SQLite** | DB locked or corrupt | Use WAL mode to prevent locks. On corruption, log error, rename DB, create fresh one. Show user notification that history was reset. |
| **Hook config** | `~/.claude/settings.json` parse error | Log warning, do not modify file. Start without hooks and show warning. |
| **Renderer IPC** | Main process unresponsive | Electron's built-in dialog: "Page unresponsive. Wait or reload?" |

**Principle:** Failures in optional systems (hooks, persistence) degrade gracefully — the core experience (PTY terminals) keeps working. Failures in PTY are surfaced clearly in the UI with actionable recovery (restart, change cwd, etc.).

---

## 11. Logging

Uses `electron-log` writing to `~/Library/Logs/mcode/main.log` (macOS standard).

- **Main process:** All PTY lifecycle events, hook server requests, session state transitions, task dispatches, DB operations
- **Renderer:** Errors only (caught by React error boundary, forwarded to main via IPC)
- **Format:** `[timestamp] [level] [module] message {structured_data}`
- **Rotation:** 5MB max per file, 3 files retained
- **Dev mode:** Also logs to terminal stdout for immediate feedback

---

## 12. Security Considerations

### 12.1 Electron Security

- **Context isolation:** Enabled — renderer cannot access Node.js
- **Node integration in renderer:** Disabled — all Node access through contextBridge
- **Preload script:** Minimal surface area — only expose typed IPC methods
- **No remote module:** Not used
- **CSP:** Strict Content-Security-Policy for renderer (no eval, no inline scripts)

### 12.2 Hook Server Security

- **Bound to localhost only** — no external access
- **Request validation:** Verify POST body schema matches expected hook format
- **No command execution:** Hook server only reads data, never executes commands from payloads

### 12.3 PTY Security

- PTY processes run as the current user with the user's environment
- No privilege escalation
- PTY input only from renderer via IPC (user keystrokes) or task queue (user-authored prompts)

---

## 13. Performance Targets

| Metric | Target |
|---|---|
| App startup to interactive | < 2 seconds |
| New session spawn to first output | < 500ms |
| Terminal input latency (keystroke to echo) | < 16ms (one frame) |
| Terminal rendering at full scroll speed | 60fps via WebGL |
| Memory per terminal session | ~15-25MB (xterm.js + PTY buffer) |
| Memory baseline (app, no sessions) | < 200MB |
| Memory with 10 active sessions | < 500MB |
| Hook event processing latency | < 10ms |
| SQLite write latency | < 1ms (synchronous, WAL mode) |

---

## 14. Implementation Phases

Each phase produces a working build with specific, verifiable behaviors. Phases are ordered so that each one builds on the previous and delivers something you can interact with.

---

### Phase 1: Skeleton App

**Goal:** Electron app launches, renders a React page with HMR, native modules compile.

**Build:**
- `electron-vite` project scaffolding with main/preload/renderer
- Tailwind CSS v4 configured in renderer via `@tailwindcss/vite` plugin (CSS-based config, no `tailwind.config.ts`)
- `node-pty` and `better-sqlite3` added as dependencies, `electron-rebuild` configured
- TypeScript strict mode across all three process targets
- `npm run dev` launches Electron with HMR for the renderer
- `src/shared/types.ts` with initial type stubs

**Verify:**
1. `npm run dev` opens an Electron window showing a React page with styled text
2. `npm run typecheck` passes with zero errors
3. No console errors in Electron DevTools
4. Changing a React component hot-reloads without restarting the app

**Files created:** `package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/styles/global.css` (Tailwind v4 uses CSS-based config via `@theme` directives, no `tailwind.config.ts`), `src/shared/types.ts`, `src/shared/constants.ts`

---

### Phase 2: Single Terminal

**Goal:** Spawn a real PTY, render it with xterm.js, type into it, see output. This validates the critical technical path: node-pty → IPC → xterm.js.

**Build:**
- `PtyManager` class: `spawn()`, `write()`, `resize()`, `kill()`
- IPC bridge for PTY channels (preload exposes `window.mcode.pty`)
- `TerminalInstance` React component with xterm.js + fit addon + WebGL addon
- App.tsx renders a single full-screen `TerminalInstance`
- On launch, auto-spawns one PTY running the user's default shell

**Verify:**
1. App launches → terminal appears → shows shell prompt (zsh/bash)
2. Type `ls` + Enter → see directory listing with correct colors
3. Run `vim` or `htop` → TUI renders correctly (tests ANSI, cursor, alternate screen)
4. Resize the window → terminal reflows text correctly (fit addon + PTY resize)
5. `Cmd+C` sends interrupt to running process
6. Close window → PTY process is killed (check with `ps`)

**Files created:** `src/main/pty-manager.ts`, `src/renderer/components/Terminal/TerminalInstance.tsx`
**Files modified:** `src/preload/index.ts`, `src/shared/types.ts`, `src/main/index.ts`, `src/renderer/App.tsx`

---

### Phase 3: Multi-Terminal Tiling

**Goal:** Multiple terminals in a draggable tiling layout. This is the first phase that feels like the actual product.

**Build:**
- `react-mosaic-component` integration in `MosaicLayout`
- `TileFactory` that maps tile IDs → `TerminalInstance`
- "New Terminal" button that spawns a PTY and adds a tile
- Close button on each tile toolbar that kills the PTY
- Tile drag-and-drop to rearrange, edge-drag to resize

**Verify:**
1. Click "+" → new terminal tile appears alongside existing ones
2. 4 terminals tiled in a 2×2 grid — all independently interactive
3. Drag a tile header → tiles rearrange with smooth animation
4. Drag tile edge → tiles resize, terminals reflow correctly
5. Close a tile → PTY is killed, tile disappears, remaining tiles fill the space
6. Run a long command in one tile → other tiles remain responsive (no blocking)

**Files created:** `src/renderer/components/Layout/MosaicLayout.tsx`, `src/renderer/components/Layout/TileFactory.tsx`, `src/renderer/components/Terminal/TerminalTile.tsx`, `src/renderer/components/Terminal/TerminalToolbar.tsx`
**Files modified:** `src/renderer/App.tsx`, `src/shared/types.ts`

---

### Phase 4: Session Sidebar & State

**Goal:** Sessions are named, tracked, and listed in a sidebar. Closing a tile doesn't kill the session — it keeps running in the background. This introduces the session concept as distinct from the terminal tile.

**Build:**
- `SessionManager` with in-memory state (no hooks yet — status based on PTY signals only: `starting` → `active` → `ended`)
- SQLite database with `sessions` table, migration infrastructure
- Sidebar component with `SessionList` and `SessionCard` (name, status dot, cwd)
- Click session card → focus/add its tile in the mosaic
- "New Session" dialog: choose cwd, optional label (spawns `claude` instead of plain shell)
- Close tile (X button) → PTY keeps running, session stays in sidebar
- Kill session (explicit action) → PTY killed, session → `ended`
- Layout state persisted to SQLite, restored on app restart

**Verify:**
1. Launch app → sidebar on left, mosaic on right
2. "New Session" → dialog with cwd picker → creates Claude Code session in a new tile
3. Session appears in sidebar with green "active" dot
4. Close the tile (X) → session card stays in sidebar, still green
5. Click the session card → tile reappears, terminal output is intact (ring buffer replay)
6. Kill session → status dot turns gray ("ended"), PTY process gone
7. Quit and relaunch → layout restored from SQLite, ended sessions shown in sidebar

**Files created:** `src/main/session-manager.ts`, `src/main/db.ts`, `src/main/logger.ts`, `db/migrations/001_initial.sql`, `src/renderer/components/Sidebar/Sidebar.tsx`, `src/renderer/components/Sidebar/SessionCard.tsx`, `src/renderer/components/Sidebar/SessionList.tsx`, `src/renderer/stores/session-store.ts`, `src/renderer/stores/layout-store.ts`
**Files modified:** `src/renderer/App.tsx`, `src/main/index.ts`, `src/main/pty-manager.ts`, `src/preload/index.ts`, `src/shared/types.ts`

---

### Phase 5: Hook Integration & Live Status

**Goal:** Hook server receives Claude Code events and drives real-time session status. This is the intelligence layer — you can now see what each agent is doing without reading its terminal.

**Build:**
- Hook HTTP server on localhost:7777 (with port fallback)
- `hook-config.ts`: on startup, merge mcode hooks into `~/.claude/settings.json`; on quit, remove them
- Session ID correlation: PTY sets `MCODE_SESSION_ID` env var, HTTP hooks forward it as `X-Mcode-Session-Id` header (via `allowedEnvVars`), hook events carry Claude's `session_id` in body — first `SessionStart` event creates the mapping
- Event persistence to `events` table
- Session status driven by hooks: `active` (SessionStart/PostToolUse), `idle` (Stop), `waiting` (PermissionRequest), `ended` (SessionEnd/PTY exit)
- Sidebar cards update in real-time: status dot color, "last tool" indicator
- `StatusBadge` component reused in sidebar cards and tile toolbars

**Verify:**
1. Start a Claude Code session → within seconds, sidebar shows "active" (green)
2. Ask Claude to read a file → sidebar briefly shows "Read" as last tool
3. Claude finishes responding → status flips to "idle" (gray)
4. Ask Claude to run a bash command in default permission mode → `PermissionRequest` hook fires → status shows "waiting" (amber)
5. Approve the tool → `PostToolUse` hook fires → status returns to "active"
6. End the session → status shows "ended"
7. `curl http://localhost:7777/hook` with garbage → returns 400, app doesn't crash
8. Quit mcode → check `~/.claude/settings.json` has no mcode hook entries left

**Files created:** `src/main/hook-server.ts`, `src/main/hook-config.ts`, `db/migrations/002_events.sql`
**Files modified:** `src/main/session-manager.ts`, `src/main/index.ts`, `src/shared/types.ts`, `src/renderer/stores/session-store.ts`, `src/renderer/components/Sidebar/SessionCard.tsx`, `src/renderer/components/Terminal/TerminalToolbar.tsx`

---

### Phase 6: Attention System

**Goal:** Sessions needing human attention are impossible to miss. This is the core UX differentiator — the reason to use mcode over multiple terminal tabs.

**Build:**
- Attention levels: **high** (permission blocked → red), **medium** (notification/error → amber), **low** (task complete → blue)
- Sidebar: attention sessions sort to top, colored left border, pulsing indicator
- Tile toolbar: border glow for high-attention sessions
- macOS dock badge: count of high-attention sessions (`app.dock.setBadge()`)
- System notification for high-attention events when mcode is not focused (`new Notification()`)
- Attention dismissed by focusing the session tile
- "Mark all read" button in sidebar

**Verify:**
1. Have Claude request a dangerous tool (Bash with rm, etc.) in default permission mode → `PermissionRequest` fires → session card turns red, sorts to top
2. Dock icon shows badge "1"
3. If mcode is in background → macOS notification appears: "Session 'myproject' needs approval"
4. Click the session card → tile focused, red indicator clears, dock badge disappears
5. Two sessions waiting simultaneously → dock shows "2", both red in sidebar
6. "Mark all read" → all attention indicators clear

**Files created:** `src/renderer/components/Sidebar/StatusBadge.tsx`
**Files modified:** `src/main/session-manager.ts`, `src/main/index.ts` (dock badge), `src/renderer/stores/session-store.ts`, `src/renderer/components/Sidebar/SessionCard.tsx`, `src/renderer/components/Terminal/TerminalToolbar.tsx`, `src/renderer/components/Sidebar/Sidebar.tsx`

---

### Phase 7: Task Queue

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

---

### Phase 8: Polish & Ship

**Goal:** Keyboard shortcuts, session resume, settings, packaging. The app feels complete for daily use.

**Build:**
- Keyboard shortcuts: `Cmd+N` (new session), `Cmd+W` (close tile), `Cmd+Shift+W` (kill session), `Cmd+1-9` (focus by index), `Cmd+\` (toggle sidebar), `Cmd+D` / `Cmd+Shift+D` (split right/down), `Cmd+Enter` (maximize/restore tile)
- Session resume: "Resume" button on ended sessions → spawns `claude --resume <claude_session_id>`
- Terminal output ring buffer replay when re-mounting a tile
- Settings/preferences: max concurrent sessions, hook server port, event retention days
- Activity feed panel (optional dashboard tile showing hook event stream)
- macOS .dmg packaging via `electron-builder`
- Performance profiling pass: check startup time, memory with 10 sessions, terminal input latency

**Verify:**
1. `Cmd+N` → new session dialog opens
2. `Cmd+1` → focuses first session tile
3. `Cmd+\` → sidebar toggles
4. `Cmd+D` on a tile → splits it, new session on the right
5. End a session → "Resume" button appears on session card → click → new PTY with conversation history
6. Close a tile, reopen from sidebar → terminal shows recent output (not blank)
7. Open Settings → change max concurrent sessions → task queue respects new limit
8. `npm run build:mac` produces a working .dmg
9. Install from .dmg → app runs without `npm`, all native modules work
10. 10 concurrent Claude Code sessions → app stays under 500MB, typing latency unnoticeable
