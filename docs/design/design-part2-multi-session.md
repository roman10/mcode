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
| `active` | PTY output detected | Agent is working |
| `ended` | PTY exit | Session terminated |

> The full state machine (`idle`, `waiting`) is added in Part 3 when hooks provide richer status signals.

**Session metadata tracked in memory and persisted to SQLite:**
- `session_id` — UUID assigned at spawn time
- `cwd` — Working directory
- `status` — Current state
- `label` — User-assigned name (defaults to cwd basename)
- `started_at` / `ended_at` — Timestamps

### PTY Manager Updates

The PTY manager from Part 1 gains:
- `MCODE_SESSION_ID=<internal_uuid>` set in PTY environment (prep for hook correlation in Part 3)
- Ring buffer (~100KB per session) for output replay when tiles are re-mounted
- `permissionMode` option for `--permission-mode` CLI flag
- `args` support for initial prompt as positional argument

```typescript
spawn(options: {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  args?: string[];             // e.g. [taskPrompt] (positional arg)
  env?: Record<string, string>;
  permissionMode?: string;     // "plan", "default", "dontAsk", "acceptEdits", "auto"
}): PtyHandle;
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

### IPC Bridge Additions

```typescript
interface MCodeAPI {
  // ... pty (from Part 1)

  sessions: {
    list(): Promise<SessionInfo[]>;
    get(sessionId: string): Promise<SessionInfo | null>;
    setLabel(sessionId: string, label: string): Promise<void>;
    onStatusChange(callback: (sessionId: string, status: string) => void): () => void;
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
│   │       ├── StatusBadge (green=active, gray=ended)
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
- Layout restored from SQLite on app startup

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

### Session Persistence

**Within a running app** — when a tile is removed but session is still active:
- PTY continues running in background
- Output buffered in main process ring buffer
- Session card stays in sidebar with live status
- Re-adding the tile replays buffered output to new xterm.js instance

**Across app restarts:**
- On quit: PTYs killed, sessions → `ended`, layout saved to SQLite
- On relaunch: layout restored, ended sessions shown in sidebar

### Additional Dependencies

```json
{
  "dependencies": {
    "react-mosaic-component": "^6.1.1",
    "zustand": "^5.0.0"
  }
}
```

> **Note:** `react-mosaic-component` 6.1.1 should be tested with React 19 — if incompatible, pin `react`/`react-dom` to `^18.3.0`.

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
