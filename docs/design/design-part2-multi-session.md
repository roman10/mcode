# mcode — Part 2: Multi-Session

> **Phases covered:** 3 (Multi-Terminal Tiling) + 4 (Session Sidebar & State)
> **Prerequisites:** Part 1 complete (Electron app with single PTY terminal)
> **Outcome:** Tiling window manager with sidebar, named sessions, SQLite persistence, session lifecycle (tile close ≠ session kill)
> **Reference:** See `design-v1.md` for full architecture

---

## Architecture Context

### Session Manager (`session-manager.ts`)

Manages the lifecycle state machine for each Claude Code session. In this part, status is driven by PTY signals only (hooks come in Part 3).

**Session state machine (simplified for Part 2 — no hooks):**

```
spawn ──► STARTING ──► ACTIVE ──► ENDED
```

| State | Trigger | Description |
|-------|---------|-------------|
| `starting` | PTY spawned | Claude Code is initializing |
| `active` | First PTY output | Agent is working |
| `ended` | PTY exit | Session terminated |

**Transition mechanism:** `PtyManager.spawn()` accepts an `onFirstData` callback. On the first `proc.onData` event, it fires the callback (once) and removes it. `SessionManager` supplies this callback to transition the session to `active` and persist the status change.

> The full state machine (`idle`, `waiting`) is added in Part 3 when hooks provide richer status signals.
>
> **Part 2 UI/MCP contract:** `starting` is a first-class state. The sidebar and `session_get_status` may report `starting` immediately after creation, and the session transitions to `active` on first PTY output. The UI should render `starting` distinctly (for example, a neutral or amber dot) rather than collapsing it into `active`.

**Session metadata tracked in memory and persisted to SQLite:**
- `session_id` — UUID assigned at spawn time
- `cwd` — Working directory
- `status` — Current state
- `label` — User-assigned name (defaults to cwd basename)
- `started_at` / `ended_at` — Timestamps

### PTY Manager Updates

The PTY manager from Part 1 gains:
- Session creation moves to `SessionManager.create()`. The renderer still never proposes IDs directly; the main process generates `session_id`, starts the PTY first, then inserts the session row only after spawn succeeds. This preserves the atomic failure contract for never-launched sessions.
- PTY launch becomes explicit: `PtyManager.spawn()` launches the provided `command` instead of always resolving the user's shell. `SessionManager.create()` uses `command: 'claude'` for Part 2 sessions.
- `MCODE_SESSION_ID=<mcode_session_id>` set in PTY environment (prep for hook correlation in Part 3)
- Ring buffer (~100KB per session) for output replay when tiles are re-mounted. Exposed via `pty:replay` IPC channel:
  - Renderer calls `window.mcode.pty.getReplayData(sessionId)` → returns buffered string
  - `TerminalInstance` calls this on mount before attaching the live data listener, writing replay data directly to xterm via `terminal.write(replayData)`
- `permissionMode` is translated by `SessionManager.create()` into Claude CLI args before calling `PtyManager.spawn()`; `PtyManager` itself receives only `command`, `args`, and `env`
- `initialPrompt` is passed as the final positional argument when non-empty
- If `claude` is missing or the PTY fails to spawn, session creation fails atomically: no session row is created, no live PTY is registered, and the error is propagated to the renderer as a rejected promise. A never-launched session is not tracked.

```typescript
spawn(options: {
  // Supplied by SessionManager before inserting the session row (spawn-first, persist-on-success).
  id: string;
  command: string;             // e.g. 'claude' for Part 2 sessions
  cwd: string;
  cols: number;
  rows: number;
  args?: string[];             // e.g. [taskPrompt] (positional arg)
  env?: Record<string, string>;
  onFirstData?: () => void;    // Fires once on the first proc.onData event
}): PtyHandle;
```

For Part 2 session creation, `SessionManager.create()` constructs the PTY launch as:

```typescript
pty.spawn({
  id: sessionId,
  command: 'claude',
  cwd,
  cols,
  rows,
  args: [
    ...(permissionMode ? ['--permission-mode', permissionMode] : []),
    ...(initialPrompt ? [initialPrompt] : []),
  ],
  env: {
    MCODE_SESSION_ID: sessionId,
  },
});
```

### Database (`db.ts`)

Uses `better-sqlite3` for synchronous, zero-dependency SQLite access.

**Schema (Part 2 subset):**

```sql
-- Core session tracking
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  label TEXT,
  cwd TEXT NOT NULL,
  permission_mode TEXT,
  status TEXT NOT NULL DEFAULT 'starting',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Layout persistence
CREATE TABLE layout_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mosaic_tree TEXT NOT NULL,
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
- Enable WAL mode during DB initialization

### Shared Types

```typescript
type SessionStatus = 'starting' | 'active' | 'ended';

interface SessionInfo {
  sessionId: string;
  label: string;
  cwd: string;
  status: SessionStatus;
  permissionMode?: string;
  startedAt: string;       // ISO 8601
  endedAt: string | null;
}
```

### IPC Bridge Additions

```typescript
interface MCodeAPI {
  pty: {
    // ... existing from Part 1 (spawn, write, resize, kill, onData, onExit)
    getReplayData(sessionId: string): Promise<string>;
  };

  sessions: {
    create(input: {
      cwd: string;
      label?: string;
      initialPrompt?: string;
      permissionMode?: string;
    }): Promise<SessionInfo>;
    list(): Promise<SessionInfo[]>;
    get(sessionId: string): Promise<SessionInfo | null>;
    kill(sessionId: string): Promise<void>;
    setLabel(sessionId: string, label: string): Promise<void>;
    onStatusChange(callback: (sessionId: string, status: SessionStatus) => void): () => void;
  };

  layout: {
    save(mosaicTree: MosaicNode<string>): Promise<void>;
    load(): Promise<MosaicNode<string> | null>;
  };

  app: {
    getVersion(): Promise<string>;
    getPlatform(): string;
    onError(callback: (error: string) => void): () => void;
  };
}
```

### Component Hierarchy

```
App
├── Sidebar (fixed left, resizable)
│   ├── AppHeader (logo, new session button)
│   ├── SessionList
│   │   └── SessionCard × N
│   │       ├── StatusBadge (amber=starting, green=active, gray=ended)
│   │       ├── SessionLabel (editable)
│   │       └── SessionActions (kill, focus)
│   └── SidebarFooter (version)
│
└── MosaicLayout (fills remaining space)
    └── TileFactory
        └── TerminalTile
            ├── TerminalToolbar (session name, status, close/kill buttons)
            └── TerminalInstance (xterm.js)
```

### Zustand Stores

**Session Store (`session-store.ts`):**

```typescript
// Zustand v5: use plain objects instead of Map/Set
interface SessionState {
  sessions: Record<string, SessionInfo>;
  selectedSessionId: string | null;

  addSession(session: SessionInfo): void;
  updateStatus(id: string, status: SessionStatus): void;
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

  setMosaicTree(tree: MosaicNode<string>): void;
  addTile(sessionId: string): void;
  removeTile(sessionId: string): void;
  setSidebarWidth(width: number): void;
  persist(): void;
  restore(): Promise<void>;
}
```

### Mosaic Layout

Uses `react-mosaic-component` for VS Code-style tiling.

```typescript
function MosaicLayout() {
  const { mosaicTree, setMosaicTree, persist } = useLayoutStore();

  const handleChange = (newTree: MosaicNode<string> | null) => {
    setMosaicTree(newTree);
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
- Control panel (future): `dashboard`

**Layout operations:**
- Double-click sidebar session → add tile (or focus existing)
- Drag tile edges → resize
- Drag tile header → rearrange
- Close button on tile → removes tile but PTY keeps running
- Layout auto-saved to SQLite on every change (debounced 500ms)
- Layout restored from SQLite on app startup, but tiles whose sessions are `ended` or missing are pruned from the restored tree before render

### New Session Dialog

Triggered by "+" button:

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

### New Session Data Flow

```
User clicks "New Session" in Sidebar
  │
  ▼
Renderer: window.mcode.sessions.create(...) ──IPC──► Main: sessionManager.create()
  │                                                     │
  │                                                     ├─ Generates `session_id`
  │                                                     ├─ Calls pty.spawn({ id: session_id, ... })
  │                                                     ├─ On success, inserts row into sessions table
  │                                                     └─ Returns SessionInfo
  │
  ◄──────────────── SessionInfo ───────────────┘
  │
  ▼
Renderer: sessionStore.addSession(session)
  │
  ├─ Stores label/cwd/status metadata locally
  └─ layoutStore.addTile(session.session_id)
  │
  ├─ Inserts tile into mosaic tree
  ├─ TerminalInstance mounts, creates xterm.js
  └─ xterm.js attaches to PTY data stream via IPC
```

### Session Persistence

**Within a running app** — when a tile is removed but session is still active:
- PTY continues running in background
- Output buffered in main process ring buffer
- Session card stays in sidebar with live status
- Re-adding the tile replays buffered output to new xterm.js instance

**Across app restarts:**
- On quit: PTYs killed, sessions → `ended`, layout saved to SQLite
- On relaunch: the saved layout is loaded and filtered to live sessions only; ended sessions are shown in the sidebar but do not re-open terminal tiles because there is no PTY to attach to

### Additional Dependencies

```json
{
  "dependencies": {
    "better-sqlite3": "^12.0.0",
    "react-mosaic-component": "^6.1.1",
    "zustand": "^5.0.0"
  }
}
```

> **Note:** `react-mosaic-component` 6.1.1 declares `peerDependencies: "react": ">=16"` — compatible with React 19. Version 7.0.0-beta0 also exists with explicit React 19 support if needed.
>
> **Native module note:** `better-sqlite3` is a native dependency. Keep the existing `electron-rebuild` postinstall flow so the module is rebuilt against the Electron runtime.

### Error Handling

| Component | Failure | Recovery |
|---|---|---|
| **PTY crash** | Process exits unexpectedly | Session → `ended`. Show exit code in tile toolbar. Offer "Restart" button. |
| **SQLite** | DB locked or corrupt | WAL mode to prevent locks. On corruption, rename DB, create fresh. Notify user. |

### Logging

```
[timestamp] [level] [module] message {structured_data}
```

- `logger.ts` wraps `electron-log`, writes to `~/Library/Logs/mcode/main.log`
- All PTY lifecycle events, session state transitions, DB operations
- 5MB max per file, 3 files retained

---

## Phase 3: Multi-Terminal Tiling

**Goal:** Multiple terminals in a draggable tiling layout. This is the first phase that feels like the actual product.

**Build:**
- `react-mosaic-component` integration in `MosaicLayout`
- `TileFactory` that maps tile IDs → `TerminalInstance`
- "New Session" button that creates a session and adds its terminal tile
- Close button on each tile toolbar removes the tile (PTY keeps running — session detach semantics from the start, since Phase 3 and 4 ship together as Part 2)
- Tile drag-and-drop to rearrange, edge-drag to resize

**Verify:**
1. Click "+" → new terminal tile appears alongside existing ones
2. 4 terminals tiled in a 2×2 grid — all independently interactive
3. Drag a tile header → tiles rearrange with smooth animation
4. Drag tile edge → tiles resize, terminals reflow correctly
5. Close a tile → tile disappears, PTY keeps running (detach), remaining tiles fill the space
6. Run a long command in one tile → other tiles remain responsive (no blocking)

**Files created:** `src/renderer/components/Layout/MosaicLayout.tsx`, `src/renderer/components/Layout/TileFactory.tsx`, `src/renderer/components/Terminal/TerminalTile.tsx`, `src/renderer/components/Terminal/TerminalToolbar.tsx`
**Files modified:** `src/renderer/App.tsx`, `src/shared/types.ts`

---

## Phase 4: Session Sidebar & State

**Goal:** Sessions are named, tracked, and listed in a sidebar. Closing a tile doesn't kill the session — it keeps running in the background. This introduces the session concept as distinct from the terminal tile.

**Build:**
- `SessionManager` with in-memory state (no hooks yet — status based on PTY signals only: `starting` → `active` → `ended`)
- SQLite database with `sessions` table, migration infrastructure
- Sidebar component with `SessionList` and `SessionCard` (name, status dot, cwd)
- Click session card → focus/add its tile in the mosaic
- "New Session" dialog: choose cwd, optional label (spawns `claude` instead of plain shell)
- Close tile (X button) → PTY keeps running, session stays in sidebar
- Kill session (explicit action) → PTY killed, session → `ended`
- Layout state persisted to SQLite, restored on app restart with ended-session tiles pruned

**Verify:**
1. Launch app → sidebar on left, mosaic on right
2. "New Session" → dialog with cwd picker → creates Claude Code session in a new tile
3. Session appears in sidebar with `starting` or `active` status; once Claude emits output, it transitions to green `active`
4. Close the tile (X) → session card stays in sidebar, still green
5. Click the session card → tile reappears, terminal output is intact (ring buffer replay)
6. Kill session → status dot turns gray ("ended"), PTY process gone
7. Quit and relaunch → layout restored from SQLite with ended-session tiles pruned; ended sessions shown in sidebar

**Files created:** `src/main/session-manager.ts`, `src/main/db.ts`, `src/main/logger.ts`, `db/migrations/001_initial.sql`, `src/renderer/components/Sidebar/Sidebar.tsx`, `src/renderer/components/Sidebar/SessionCard.tsx`, `src/renderer/components/Sidebar/SessionList.tsx`, `src/renderer/stores/session-store.ts`, `src/renderer/stores/layout-store.ts`
**Files modified:** `src/renderer/App.tsx`, `src/main/index.ts`, `src/main/pty-manager.ts`, `src/preload/index.ts`, `src/shared/types.ts`

---

## MCP Devtools Extension for Part 2

Per project principle: every feature must be exposed to coding agents for automated verification. The existing MCP devtools server (`src/devtools/`) needs these additions:

### New MCP Tools

The Part 1 PTY-oriented MCP tools `session_list` and `session_info` are superseded in Part 2 by the session-level tools below. Low-level terminal inspection remains under the existing `terminal_*` tools for live, attached PTYs.

| Tool | Purpose | Verification criteria covered |
|------|---------|-------------------------------|
| `session_create` | Create a new session (cwd, label, initialPrompt, permissionMode) | P3.1, P4.2 |
| `session_kill` | Kill a session by ID | P4.6 |
| `session_get_status` | Get session status/metadata | P4.3, P4.4, P4.6 |
| `layout_get_tree` | Return current mosaic tree as JSON | P3.2, P4.1 |
| `layout_add_tile` | Add a tile for a session ID | P4.5 |
| `layout_remove_tile` | Remove a tile (without killing session) | P3.5, P4.4 |
| `layout_get_tile_count` | Count visible tiles | P3.2, P3.5 |
| `sidebar_get_sessions` | List sessions shown in sidebar with status | P4.3, P4.4, P4.6 |

### Automated Verification Mapping

**Phase 3:**
1. `session_create` → `layout_get_tile_count` (was 1, now 2)
2. Create 4 sessions → `layout_get_tile_count` == 4, each `terminal_read_buffer` returns content
3. Drag rearrange — `window_screenshot` before/after (visual)
4. Drag resize — `terminal_get_dimensions` shows changed cols/rows
5. `layout_remove_tile` → `layout_get_tile_count` decremented, `session_get_status` still "active" (detach, not kill)
6. `terminal_send_keys` long command in one tile, `terminal_read_buffer` in another (responsiveness)

**Phase 4:**
1. `window_screenshot` → sidebar visible on left
2. `session_create` with cwd/label → `session_get_status` returns metadata
3. `sidebar_get_sessions` → session with `starting` or `active` status
4. `layout_remove_tile` → `sidebar_get_sessions` still shows session as `starting` or `active`
5. `layout_add_tile` → `terminal_read_buffer` returns content (ring buffer replay)
6. `session_kill` → `session_get_status` returns "ended"
7. Layout persistence — requires app restart, outside MCP scope (manual or scripted)

**Files modified:** `src/devtools/tools/session-tools.ts`, `src/devtools/tools/` (new `layout-tools.ts`)
