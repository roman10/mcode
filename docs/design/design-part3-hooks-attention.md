# mcode — Part 3: Hooks & Attention

> **Phases covered:** 5 (Hook Integration & Live Status) + 6 (Attention System)
> **Prerequisites:** Part 2 complete (multi-session tiling with sidebar and SQLite)
> **Outcome:** Real-time session status driven by Claude Code hooks, attention system with dock badges and notifications
> **Reference:** See `design-v1.md` for full architecture

---

## Architecture Context

### Hook Server (`hook-server.ts`)

A lightweight HTTP server (Node.js `http` module, no framework) running on `localhost:7777` that receives Claude Code hook POST requests.

**Request handling:**

```
POST /hook
Content-Type: application/json
X-Mcode-Session-Id: <mcode_session_id>    ← forwarded from PTY env via hook headers

{
  "session_id": "abc-123",              ← Claude Code's own session ID
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "cwd": "/Users/feipeng/project",
  ...
}
```

**Processing pipeline:**

1. Parse JSON body
2. Read `x-mcode-session-id` header (Node.js `http` module lowercases all headers) → this is the internal session ID
3. Read `session_id` from JSON body → this is Claude Code's session ID
4. On first `SessionStart` event, store the mapping: internal ID ↔ Claude session ID
5. Persist raw event to `events` table
6. Update session state via Session Manager
7. Emit event to renderer via IPC (`hook:event`)
8. Return `200 OK` (or `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow|deny", "permissionDecisionReason": "..."}}` for `PreToolUse` hooks when auto-approval rules are configured)

**PreToolUse decision engine (future):**
- Rules stored in SQLite, evaluated on each `PreToolUse` event
- Decision format: `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow|deny|ask", "permissionDecisionReason": "reason"}}`
- Default: return plain `200 OK` with no body (pass through)

**Port selection:**
- Default: 7777
- On startup, check if port is in use; if so, try 7778-7799
- Store chosen port so hook config entries use the correct URL

### Hook Configuration (`hook-config.ts`)

Claude Code hooks are configured in `~/.claude/settings.json` using a structured format.

**Strategy:**

1. On startup, read existing `~/.claude/settings.json`
2. **Remove any stale mcode hook entries** (identifiable by `localhost:77xx/hook` URL pattern) — crash recovery, since `before-quit` cleanup won't fire on force-quit or crash
3. Merge mcode's hook entries into the `hooks` object:
   ```json
   {
     "hooks": {
       "PreToolUse": [
         { "hooks": [{ "type": "http", "url": "http://localhost:7777/hook", "headers": { "X-Mcode-Session-Id": "$MCODE_SESSION_ID" }, "allowedEnvVars": ["MCODE_SESSION_ID"] }] }
       ],
       "PostToolUse": [ ... ],
       "PostToolUseFailure": [ ... ],
       "Stop": [ ... ],
       "PermissionRequest": [ ... ],
       "SessionStart": [ ... ],
       "SessionEnd": [ ... ],
       "Notification": [ ... ]
     },
     "allowedHttpHookUrls": ["http://localhost:*"]
   }
   ```
   Identical hooks are auto-deduplicated by Claude Code, so appending is safe.
4. Write merged config back, preserving all existing user hooks
5. On quit, remove mcode's hook entries (leave user hooks intact)
6. Store a backup of the original settings before modification
7. Must ensure `"allowedHttpHookUrls"` includes `"http://localhost:*"`

**Startup ordering (critical):**
1. Start hook HTTP server → determine actual port
2. Write hook config to `~/.claude/settings.json` using actual port
3. Only then allow session creation (Claude Code snapshots hooks at its startup)

This ordering ensures the server is ready before any Claude Code process tries to POST to it, and the config references the correct port.

### Session ID Correlation

The mapping between mcode's session ID and Claude Code's session ID works as follows:

1. mcode spawns PTY with env var `MCODE_SESSION_ID=<mcode_session_id>`
2. Claude Code inherits this env var
3. Hook config includes `"headers": { "X-Mcode-Session-Id": "$MCODE_SESSION_ID" }` and `"allowedEnvVars": ["MCODE_SESSION_ID"]`
4. Every hook POST to the server carries the `X-Mcode-Session-Id` header
5. The JSON body contains Claude Code's `session_id`
6. On first `SessionStart` event, the server creates the mapping

### Session State Machine (full, with hooks)

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
| `active` | `SessionStart` hook or `PostToolUse` hook | Agent is working |
| `idle` | `Stop` hook (payload has `stop_hook_active` and `last_assistant_message`) | Agent finished, waiting for input |
| `waiting` | `PermissionRequest` hook or `Notification` hook | Needs human approval or attention |
| `ended` | PTY exit or `SessionEnd` hook | Session terminated |

**Session metadata additions (to existing sessions table):**
- `claude_session_id` — Claude Code's own session ID (from hooks)
- `last_tool` — Last tool used (from `PostToolUse`)
- `last_event_at` — Timestamp of most recent hook event
- `attention_reason` — Why this session needs attention (null if it doesn't)

### Database Additions

```sql
-- Add columns to sessions table
ALTER TABLE sessions ADD COLUMN claude_session_id TEXT;
ALTER TABLE sessions ADD COLUMN attention_reason TEXT;
ALTER TABLE sessions ADD COLUMN last_tool TEXT;
ALTER TABLE sessions ADD COLUMN last_event_at TEXT;

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
```

**Data retention:**
- Events table: auto-prune events older than 7 days (configurable)
- Pruning runs on app startup and once per hour
- Payload size cap: truncate `tool_input` fields to 4KB before storage; strip large binary/diff content. The event log drives status, not full audit.

### IPC Bridge Additions

```typescript
interface MCodeAPI {
  // ... pty, sessions (from Parts 1-2)

  // Update sessions to include reason
  sessions: {
    // ... existing methods
    onStatusChange(callback: (sessionId: string, status: string, reason?: string) => void): () => void;
  };

  hooks: {
    onEvent(callback: (event: HookEvent) => void): () => void;
    getRecent(sessionId: string, limit?: number): Promise<HookEvent[]>;
  };
}
```

### Hook Event Data Flow

```
Claude Code (inside PTY) ──HTTP POST──► Hook Server (:7777)
                                           │
                                           ├─ Parse JSON payload
                                           ├─ Read X-Mcode-Session-Id header
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

### Attention System

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

### Session Store Updates

```typescript
interface SessionState {
  sessions: Record<string, SessionInfo>;
  selectedSessionId: string | null;
  attentionSessionIds: string[];         // Sessions needing human input

  // ... existing actions
  updateStatus(id: string, status: SessionStatus, reason?: string): void;
}
```

### Error Handling

| Component | Failure | Recovery |
|---|---|---|
| **Hook server bind** | Port 7777 in use | Auto-increment to 7778-7799. If all fail, start without hooks and show warning. |
| **Hook server request** | Malformed JSON / unknown event | Log warning, return 400, do not crash server. |
| **Hook config** | `~/.claude/settings.json` parse error | Log warning, do not modify file. Start without hooks and show warning. |

**Principle:** Failures in hooks degrade gracefully — the core PTY terminal experience keeps working.

### Hook Server Security

- **Bound to localhost only** — no external access
- **Request validation:** Verify POST body schema matches expected hook format
- **No command execution:** Hook server only reads data, never executes commands from payloads

---

## Phase 5: Hook Integration & Live Status

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

## Phase 6: Attention System

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
