# mcode — Part 3: Hooks & Attention

> **Phases covered:** 5 (Hook Integration & Live Status) + 6 (Attention System)
> **Prerequisites:** Part 2 complete (multi-session tiling with sidebar and SQLite)
> **Outcome:** Real-time session state driven by Claude Code hooks where available, explicit fallback behavior when hooks are unavailable, and an attention system that is testable through MCP
> **Reference:** See `design-v1.md` for full architecture

---

## Architecture Context

### Hook Subsystem Runtime

The hook subsystem has an explicit runtime state. This removes ambiguity during startup and when hook integration fails.

```typescript
type HookRuntimeState = 'initializing' | 'ready' | 'degraded';

interface HookRuntimeInfo {
  state: HookRuntimeState;
  port: number | null;
  warning: string | null;
}
```

- `initializing`: app startup is in progress; hook server/config is not ready yet
- `ready`: hook server is bound, Claude settings have been reconciled, new Claude sessions will receive hooks
- `degraded`: hook integration failed; Claude sessions still launch, but only PTY fallback status is available

**Creation gating:**

1. App startup begins with hook runtime = `initializing`
2. Start hook HTTP server and attempt config reconciliation
3. If both succeed, runtime becomes `ready`
4. If either fails, runtime becomes `degraded` and a warning is surfaced in UI/devtools

**Session creation behavior:**

- While runtime is `initializing`, UI session creation is disabled and MCP `session_create` returns a retryable error for Claude sessions
- When runtime becomes `ready`, Claude sessions launch in live hook mode
- When runtime becomes `degraded`, Claude sessions are allowed to launch in fallback mode
- Non-Claude commands used by tests/devtools may launch regardless of hook runtime state

This keeps startup deterministic without making hook failures fatal.

### Hook Server (`hook-server.ts`)

A lightweight HTTP server (Node.js `http` module, no framework) running on `localhost:7777` that receives Claude Code hook POST requests.

**Request handling:**

```
POST /hook
Content-Type: application/json
X-Mcode-Hook: 1
X-Mcode-Session-Id: <mcode_session_id>

{
  "session_id": "abc-123",
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "cwd": "/Users/feipeng/project",
  ...
}
```

**Validation rules:**

- Accept only `POST /hook`
- Require JSON body with `hook_event_name`
- Accept only known Claude hook events used by this phase:
  - `PreToolUse`
  - `PostToolUse`
  - `PostToolUseFailure`
  - `Stop`
  - `PermissionRequest`
  - `SessionStart`
  - `SessionEnd`
  - `Notification`
- Resolve internal session identity in this order:
  1. `x-mcode-session-id` header
  2. existing lookup by `session_id` / `claude_session_id`
- Return `400` for malformed JSON or invalid schema
- Return `404` for syntactically valid payloads that cannot be correlated to a session

**Processing pipeline:**

1. Parse and validate JSON body
2. Resolve internal session ID
3. Persist sanitized event to `events`
4. Persist `claude_session_id` onto the session whenever `session_id` is present
5. Apply event to `SessionManager.handleHookEvent()`
6. Emit IPC updates:
   - `session:updated` with full `SessionInfo`
   - `hook:event` with raw/sanitized `HookEvent`
7. Return `200 OK`
8. For `PreToolUse`, optionally return `hookSpecificOutput` if/when approval rules are implemented

**PreToolUse decision engine (future, not Phase 5):**

- Rules stored in SQLite, evaluated on each `PreToolUse` event
- Decision format:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask",
    "permissionDecisionReason": "reason"
  }
}
```

- Phase 5 default: plain `200 OK` with no decision body

**Port selection:**

- Default: 7777
- On startup, try 7777, then 7778-7799
- Store chosen port in `HookRuntimeInfo`
- If all ports fail, runtime becomes `degraded`

### Hook Configuration (`hook-config.ts`)

Claude Code hooks are configured in `~/.claude/settings.json` using a structured format.

**Strategy:**

1. Read existing `~/.claude/settings.json`
2. If the file does not exist, treat it as `{}` and create it on write
3. Before mutating, write a one-time backup to `~/.claude/settings.json.mcode.bak`
4. Remove stale mcode hook entries left behind by prior crashes
5. Merge mcode hook entries into the `hooks` object
6. Ensure `allowedHttpHookUrls` contains `http://localhost:*`
7. On app quit, remove only mcode-owned hooks and leave user hooks intact

**mcode-owned hook marker:**

Do not identify stale hooks by URL alone. Each mcode hook entry must include a static marker header:

```json
{
  "type": "http",
  "url": "http://localhost:7777/hook",
  "headers": {
    "X-Mcode-Hook": "1",
    "X-Mcode-Session-Id": "$MCODE_SESSION_ID"
  },
  "allowedEnvVars": ["MCODE_SESSION_ID"]
}
```

This avoids removing a user-created localhost hook that happens to use the same port range.

**Merge/remove implementation requirement:**

`hook-config.ts` must expose pure functions for:

- `removeMcodeHooks(settings)`
- `mergeMcodeHooks(settings, port)`

These are tested against temp fixtures without touching the real home directory.

**Startup ordering (critical):**

1. Start hook HTTP server and determine actual port
2. Reconcile `~/.claude/settings.json` with that port
3. Set hook runtime to `ready` or `degraded`
4. Only then allow normal Claude session creation

This ensures the server is ready before any Claude Code process snapshots hook config.

### Session Correlation

The internal mcode session ID is authoritative. Claude's `session_id` is secondary metadata.

1. mcode spawns PTY with env var `MCODE_SESSION_ID=<mcode_session_id>`
2. Claude Code inherits this env var
3. Hook config forwards it as `X-Mcode-Session-Id`
4. Every hook POST is correlated to the internal session by header when available
5. `session_id` from the JSON body is persisted to `sessions.claude_session_id` when present
6. Lookup by `claude_session_id` exists only as a fallback for malformed/missing headers or future recovery tooling

`SessionStart` is typically the first hook carrying `session_id`, but the implementation must not depend on that ordering.

### Session State Model

Execution status and attention are separate concerns.

```typescript
type SessionStatus = 'starting' | 'active' | 'idle' | 'waiting' | 'ended';
type SessionAttentionLevel = 'none' | 'low' | 'medium' | 'high';
```

**Execution status:**

| Status | Meaning |
|---|---|
| `starting` | PTY spawned; Claude is initializing |
| `active` | Claude is actively working or just resumed after approval |
| `idle` | Claude finished a turn and is awaiting user input |
| `waiting` | Claude is blocked on explicit human approval |
| `ended` | PTY exited or session ended |

**Attention level:**

| Level | Meaning |
|---|---|
| `none` | No attention needed |
| `low` | Informational completion signal |
| `medium` | Something noteworthy happened, but the agent is not blocked |
| `high` | The session is blocked on the user |

**Event to state rules:**

| Event | Status transition | Attention transition |
|---|---|---|
| PTY spawn | `starting` | `none` |
| first PTY data in fallback mode only | `starting -> active` | unchanged |
| `SessionStart` | `starting -> active` | unchanged |
| `PostToolUse` | `waiting -> active` or stay `active` | clear `high`; keep lower levels only if explicitly re-raised later |
| `Stop` | `active -> idle` or `waiting -> idle` if permission is no longer pending | set `low` unless a higher level already exists |
| `PermissionRequest` | `* -> waiting` | set `high` |
| `Notification` | no status change | set `medium` unless current attention is `high` |
| `PostToolUseFailure` | no status change | set `medium` unless current attention is `high` |
| `SessionEnd` | `* -> ended` | clear to `none` |
| PTY exit | `* -> ended` | clear to `none` |

**Important rule:** `Notification` does not move a session into `waiting`. It raises attention only.

### Fallback Behavior When Hooks Are Unavailable

If hook runtime is `degraded`, session execution still works.

**Fallback mode contract:**

- New Claude sessions are allowed to launch
- Status is PTY-driven only:
  - `starting -> active` on first PTY data
  - `active -> ended` on PTY exit
- `idle` and `waiting` are unreachable in fallback mode
- `last_tool`, `last_event_at`, and attention metadata remain `null` / `none`
- UI shows a global warning that hook-driven live status is unavailable

This preserves the core terminal experience instead of leaving sessions stuck in `starting`.

### Session Metadata Additions

`SessionInfo` grows to support live status, attention, and automation.

```typescript
interface SessionInfo {
  sessionId: string;
  label: string;
  cwd: string;
  status: SessionStatus;
  permissionMode?: string;
  startedAt: string;
  endedAt: string | null;

  claudeSessionId: string | null;
  lastTool: string | null;
  lastEventAt: string | null;
  attentionLevel: SessionAttentionLevel;
  attentionReason: string | null;
  hookMode: 'live' | 'fallback';
}
```

### Database Additions

```sql
-- Add columns to sessions table
ALTER TABLE sessions ADD COLUMN claude_session_id TEXT;
ALTER TABLE sessions ADD COLUMN last_tool TEXT;
ALTER TABLE sessions ADD COLUMN last_event_at TEXT;
ALTER TABLE sessions ADD COLUMN attention_level TEXT NOT NULL DEFAULT 'none';
ALTER TABLE sessions ADD COLUMN attention_reason TEXT;

-- Hook event log (append-only)
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  claude_session_id TEXT,
  hook_event_name TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE INDEX idx_events_session ON events(session_id, created_at);
CREATE INDEX idx_events_type ON events(hook_event_name);
CREATE INDEX idx_sessions_claude_session_id ON sessions(claude_session_id);
```

**Data retention:**

- Events table is auto-pruned after 7 days
- Pruning runs on app startup and once per hour
- `tool_input` is truncated to 4 KB before storage
- Large text blobs such as diff/patch content are stripped before persistence
- The event log is for state reconstruction and debugging, not full auditing

### IPC Bridge Additions

The renderer should consume full session updates rather than piecemeal status args.

```typescript
interface HookEvent {
  sessionId: string;
  claudeSessionId: string | null;
  hookEventName: string;
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  createdAt: string;
  payload: Record<string, unknown>;
}

interface MCodeAPI {
  sessions: {
    create(input: SessionCreateInput): Promise<SessionInfo>;
    list(): Promise<SessionInfo[]>;
    get(sessionId: string): Promise<SessionInfo | null>;
    kill(sessionId: string): Promise<void>;
    setLabel(sessionId: string, label: string): Promise<void>;
    clearAttention(sessionId: string): Promise<void>;
    clearAllAttention(): Promise<void>;
    onUpdated(callback: (session: SessionInfo) => void): () => void;
    onCreated(callback: (session: SessionInfo) => void): () => void;
  };

  hooks: {
    getRuntime(): Promise<HookRuntimeInfo>;
    onEvent(callback: (event: HookEvent) => void): () => void;
    getRecent(sessionId: string, limit?: number): Promise<HookEvent[]>;
  };
}
```

**Implementation note:** since the app is pre-release, replace the existing `session:status-change` IPC with `session:updated` instead of trying to preserve both.

### Hook Event Data Flow

```
Claude Code (inside PTY) ──HTTP POST──► Hook Server (:7777)
                                           │
                                           ├─ Parse + validate JSON payload
                                           ├─ Resolve internal session ID
                                           ├─ INSERT sanitized row into events
                                           ├─ SessionManager.handleHookEvent()
                                           │    ├─ Update status
                                           │    ├─ Update attention
                                           │    ├─ Update last_tool / last_event_at
                                           │    └─ Persist claude_session_id
                                           │
                                           └─ IPC broadcast
                                                │
                                                ├─ session:updated
                                                └─ hook:event
```

### Attention System

The attention system exists alongside status, not inside it.

**Attention triggers:**

| Hook Event | Condition | Attention Level | Visual Treatment |
|---|---|---|---|
| `PermissionRequest` | Any | `high` | Red pulse, tile border glow, dock badge |
| `Notification` | Any | `medium` | Amber indicator on session card / toolbar |
| `PostToolUseFailure` | Any | `medium` | Amber warning indicator |
| `Stop` | Any | `low` | Blue completion dot |

**Priority rules:**

- `high` overrides `medium`, `low`, and `none`
- `medium` overrides `low` and `none`
- `low` is only applied if no higher attention exists
- `ended` always clears attention
- Explicit user dismissal clears all levels for that session

**Visual treatment:**

- Sidebar session card: colored left border + attention badge + attention-first sort
- Terminal tile toolbar: status badge plus glow for `high`
- macOS dock badge: count of sessions at `high`
- System notification: emit only for newly raised `high` attention when the app is not focused

### Attention Dismissal and Focus Semantics

Attention clearing is driven by explicit user focus, not by incidental rendering.

**Canonical focus state:**

- `selectedSessionId` in the renderer store is the canonical focused session

**User actions that set it:**

- Clicking a session card
- Double-clicking a session card to open a tile
- Pointer down / focus on a session tile or its terminal area

**Dismissal rule:**

- When `selectedSessionId` changes because of an explicit user action, clear attention for that session
- Do not clear attention during app startup, layout restore, or programmatic tile restoration
- Sidebar "Mark all read" clears attention for all sessions but does not change status

### Session Store Updates

```typescript
interface SessionState {
  sessions: Record<string, SessionInfo>;
  selectedSessionId: string | null;
  hookRuntime: HookRuntimeInfo;

  addSession(session: SessionInfo): void;
  upsertSession(session: SessionInfo): void;
  selectSession(id: string | null, source?: 'user' | 'system'): void;
  setHookRuntime(info: HookRuntimeInfo): void;
}
```

The store no longer computes attention from scratch in the renderer. The main process is the source of truth.

### Automated Verification Surface

Per repo policy, this feature must be exposed to coding agents for automated verification.

**MCP additions:**

- `app_get_hook_runtime`
  - returns `HookRuntimeInfo`
- `app_get_attention_summary`
  - returns per-level counts plus the current dock badge string
- `hook_inject_event`
  - injects a validated synthetic hook event directly into the same `SessionManager.handleHookEvent()` path used by the HTTP server
  - does not touch `~/.claude/settings.json`
  - intended for tests and agent-driven verification
- `hook_list_recent`
  - returns recent persisted events for a session
- `session_wait_for_status`
  - extend enum to `starting | active | idle | waiting | ended`
- `session_wait_for_attention`
  - wait until a session reaches `none | low | medium | high`
- `session_clear_attention`
  - clear one session's attention
- `session_clear_all_attention`
  - clear all sessions' attention

**Test strategy:**

- Hook state transitions are tested with `hook_inject_event`, not by launching a real Claude binary
- Hook config merge/remove is unit-tested against temp fixture files
- HTTP server validation is tested with direct HTTP requests to the local hook server
- UI attention sorting/dismissal is tested through MCP renderer/devtools queries, not by manual observation alone

### Error Handling

| Component | Failure | Recovery |
|---|---|---|
| Hook server bind | Port 7777 in use | Try 7778-7799, else runtime = `degraded` |
| Hook server request | Malformed JSON / invalid schema | Return 400, log warning, keep server alive |
| Hook server correlation | Valid payload but unknown session | Return 404, log warning |
| Hook config parse | `~/.claude/settings.json` invalid JSON | runtime = `degraded`, do not overwrite file |
| Hook config write | Permission or disk error | runtime = `degraded`, keep PTY experience available |

**Principle:** hook failures degrade live status and attention, but never the core PTY terminal experience.

### Hook Server Security

- Bound to localhost only
- Validate payload schema before any state mutation
- Never execute commands from hook payloads
- Truncate stored payloads to avoid unbounded diff/log persistence

---

## Phase 5: Hook Integration & Live Status

**Goal:** Hook server receives Claude Code events and drives real-time session state. When hooks are unavailable, sessions still work via PTY fallback.

**Build:**

- Hook HTTP server on localhost:7777 with port fallback
- `hook-config.ts` with pure merge/remove helpers plus app startup/quit integration
- Hook runtime state: `initializing`, `ready`, `degraded`
- Session correlation using `X-Mcode-Session-Id` as the primary identity
- Event persistence to `events`
- `SessionManager.handleHookEvent()` as the single source of truth for status/metadata updates
- Replace renderer status-only IPC with `session:updated`
- Sidebar and terminal toolbar show status plus last tool when hook data exists
- Fallback mode keeps `starting -> active -> ended` working when hooks are degraded

**Automated verify:**

1. `app_get_hook_runtime` returns `ready` or `degraded` after startup, never remains `initializing`
2. Create a test session and inject `SessionStart` via `hook_inject_event` -> session becomes `active`
3. Inject `PostToolUse` with `tool_name = Read` -> `session_get_status` shows `lastTool = Read`
4. Inject `Stop` -> `session_wait_for_status` reaches `idle`
5. Inject `PermissionRequest` -> `session_wait_for_status` reaches `waiting`
6. Inject `PostToolUse` -> session returns to `active`
7. Inject `SessionEnd` or kill the PTY -> session reaches `ended`
8. POST garbage to `/hook` -> HTTP 400 and app remains healthy
9. Unit-test `hook-config.ts` cleanup so only marker-owned hooks are removed

**Manual smoke:**

1. Start a real Claude session -> sidebar turns `active`
2. Ask Claude to read a file -> sidebar shows `Read` as last tool
3. Let Claude finish responding -> status flips to `idle`
4. Trigger a permission request -> status flips to `waiting`
5. Approve it -> status returns to `active`
6. Quit mcode -> `~/.claude/settings.json` no longer contains mcode hook entries

**Files created:** `src/main/hook-server.ts`, `src/main/hook-config.ts`, `src/devtools/tools/hook-tools.ts`, `db/migrations/002_hooks.sql`, `tests/suites/hook-integration.test.ts`

**Files modified:** `src/main/session-manager.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/App.tsx`, `src/renderer/stores/session-store.ts`, `src/renderer/components/Sidebar/SessionList.tsx`, `src/renderer/components/Sidebar/SessionCard.tsx`, `src/renderer/components/Terminal/TerminalToolbar.tsx`, `src/devtools/mcp-server.ts`, `src/devtools/tools/session-tools.ts`, `tests/helpers.ts`

---

## Phase 6: Attention System

**Goal:** Sessions needing human attention are obvious, sortable, dismissible, and verifiable through automation.

**Build:**

- Attention levels: `high`, `medium`, `low`, `none`
- Main process computes and persists attention level/reason
- Sidebar sorts by attention first, then by status/start time
- Shared `StatusBadge` component renders execution status plus attention indicator
- Tile toolbar glows for `high` attention
- macOS dock badge shows count of sessions at `high`
- System notification fires only when `high` attention is newly raised and the app is unfocused
- Attention clears on explicit user focus of that session
- Sidebar includes `Mark all read`

**Automated verify:**

1. Inject `PermissionRequest` -> session attention becomes `high`, status becomes `waiting`
2. `app_get_attention_summary` reports one `high` session and dock badge `1`
3. Inject `Notification` on another active session -> attention becomes `medium`, status stays unchanged
4. Inject `Stop` on a third session -> attention becomes `low`, status becomes `idle`
5. Call `session_clear_attention` on the waiting session -> attention clears, status remains `waiting` until another execution event changes it
6. Call `session_clear_all_attention` -> all attention indicators clear
7. Simulate explicit user selection of a session tile/card -> attention for that session clears only

**Manual smoke:**

1. Trigger a real permission request -> session card turns red and sorts to top
2. Move mcode to background and trigger another permission request -> macOS notification appears
3. Click the session card or focus its tile -> attention clears
4. Two sessions waiting simultaneously -> dock badge shows `2`
5. Use `Mark all read` -> all attention indicators clear

**Files created:** `src/renderer/components/Sidebar/StatusBadge.tsx`, `tests/suites/attention-system.test.ts`

**Files modified:** `src/main/session-manager.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/App.tsx`, `src/renderer/stores/session-store.ts`, `src/renderer/components/Layout/MosaicLayout.tsx`, `src/renderer/components/Terminal/TerminalTile.tsx`, `src/renderer/components/Sidebar/Sidebar.tsx`, `src/renderer/components/Sidebar/SessionList.tsx`, `src/renderer/components/Sidebar/SessionCard.tsx`, `src/renderer/components/Terminal/TerminalToolbar.tsx`, `src/devtools/tools/app-tools.ts`, `src/devtools/tools/session-tools.ts`
