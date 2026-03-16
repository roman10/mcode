# MCP Integration Tests

Automated integration tests that verify mcode features by calling MCP devtools tools against a live Electron app.

## Prerequisites

The app must be running in dev mode with the MCP server listening on `http://127.0.0.1:7532/mcp`.

```bash
npm run dev
# Wait for "[mcode-devtools] MCP server listening on port 7532"
```

## Running Tests

```bash
# Run all test suites (sequential, 30s timeout per test)
npm run test:mcp

# Run a single suite
npx vitest run --config vitest.config.mts tests/suites/session-lifecycle.test.ts

# Run tests matching a name pattern
npx vitest run --config vitest.config.mts -t "resizes terminal"
```

## Architecture

```
tests/
├── mcp-client.ts          # MCP SDK client wrapper (connects to localhost:7532)
├── helpers.ts             # Composable test helpers (session lifecycle, layout)
├── suites/                # Test suites organized by feature area
│   ├── session-lifecycle  # Core session state machine
│   ├── tiling-layout      # Mosaic layout management
│   ├── sidebar-sessions   # Sidebar ↔ DB consistency
│   ├── sidebar-interaction # Selection and sidebar width
│   ├── detach-semantics   # Tile removal vs session kill
│   ├── terminal-io        # Basic terminal read/write
│   ├── terminal-advanced  # Resize, Ctrl+C, timeouts
│   ├── window-tools       # Screenshot, bounds, resize
│   ├── app-introspection  # Version, console logs, HMR
│   ├── error-cases        # Error responses for invalid inputs
│   └── concurrent-sessions # Multi-session stress test
└── vitest.config.mts      # Sequential execution, 30s timeout
```

**Test client** (`tests/mcp-client.ts`): Thin wrapper around `@modelcontextprotocol/sdk` Client with `StreamableHTTPClientTransport`. Provides `callTool()` (raw result), `callToolJson<T>()` (auto-parse), and `callToolText()` (extract text).

**Helpers** (`tests/helpers.ts`): Composable building blocks that combine MCP tool calls:
- `createTestSession(client, overrides?)` — creates a session with `command: "bash"`
- `waitForActive(client, sessionId)` — polls `session_wait_for_status` until active
- `killAndWaitEnded(client, sessionId)` — kills and waits for ended status
- `cleanupSessions(client, ids)` — best-effort kill all (used in afterAll)
- `getTileCount(client)` — reads `layout_get_tile_count`

**Execution model**: All suites run sequentially (no parallelism) because they share a single Electron app instance. Each suite manages its own sessions via `beforeAll`/`afterAll` cleanup.

---

## MCP Tools Used

28 tools across 5 categories. Each test case lists the tools it exercises.

| Category | Tools |
|----------|-------|
| **Session** (7) | `session_create`, `session_list`, `session_get_status`, `session_kill`, `session_info`, `session_wait_for_status`, `session_set_label` |
| **Terminal** (5) | `terminal_read_buffer`, `terminal_send_keys`, `terminal_get_dimensions`, `terminal_resize`, `terminal_wait_for_content` |
| **Layout** (7) | `layout_get_tree`, `layout_add_tile`, `layout_remove_tile`, `layout_get_tile_count`, `layout_get_sidebar_width`, `layout_set_sidebar_width`, `sidebar_get_sessions` |
| **Sidebar** (2) | `sidebar_select_session`, `sidebar_get_selected` |
| **Window** (3) | `window_screenshot`, `window_get_bounds`, `window_resize` |
| **App** (3) | `app_get_version`, `app_get_console_logs`, `app_get_hmr_events` |

---

## Test Suites

### 1. Session Lifecycle

**File**: `tests/suites/session-lifecycle.test.ts`
**What it verifies**: The core session state machine — creation, status transitions, metadata, and teardown.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | creates a session with starting status | `session_create` | sessionId is UUID format, status is `starting`, startedAt is set, endedAt is null |
| 2 | transitions from starting to active | `session_wait_for_status` | Status becomes `active` after PTY emits first data |
| 3 | appears in session list | `session_list` | The created session is present in the full list with `active` status |
| 4 | can set label | `session_set_label`, `session_get_status` | Label update returns new label; re-reading from DB confirms persistence |
| 5 | has PTY info with valid pid and dimensions | `session_info` | pid > 0, cols > 0, rows > 0 |
| 6 | kills session and transitions to ended | `session_kill`, `session_wait_for_status`, `session_get_status` | Status becomes `ended`, endedAt is set |
| 7 | double kill is safe (idempotent) | `session_kill` | Second kill on already-ended session does not error |

### 2. Tiling Layout

**File**: `tests/suites/tiling-layout.test.ts`
**What it verifies**: Mosaic tiling — auto-tile on session creation, add/remove tiles, tree structure.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | session creation auto-adds a tile | `session_create`, `session_wait_for_status`, `layout_get_tile_count` | Tile count increments by 1 after session creation (via `session:created` IPC auto-tile) |
| 2 | second session creation adds another tile | `session_create`, `session_wait_for_status`, `layout_get_tile_count` | Tile count increments again for a second session |
| 3 | layout tree contains both session IDs | `layout_get_tree` | JSON-serialized tree contains both session IDs |
| 4 | removes a tile without killing the session | `layout_remove_tile`, `layout_get_tile_count`, `session_get_status` | Tile count decrements but session remains `active` |
| 5 | re-adds a removed tile | `layout_add_tile`, `layout_get_tile_count` | Tile count increments back after re-adding |
| 6 | returns error when adding tile for non-existent session | `layout_add_tile` | isError is true for a fake UUID |

### 3. Sidebar Sessions

**File**: `tests/suites/sidebar-sessions.test.ts`
**What it verifies**: Sidebar Zustand store reflects DB state — session appearance, status tracking, label persistence.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | shows created session in sidebar | `session_create`, `sidebar_get_sessions` | Newly created session appears in sidebar list |
| 2 | sidebar shows active status after transition | `session_wait_for_status`, `sidebar_get_sessions` | Sidebar entry shows `active` after PTY starts |
| 3 | sidebar shows ended status after kill | `session_kill`, `session_wait_for_status`, `sidebar_get_sessions` | Sidebar entry shows `ended` after kill |
| 4 | set label persists to DB | `session_create`, `session_wait_for_status`, `session_set_label`, `session_get_status` | Label change via MCP persists in SQLite (note: sidebar Zustand store does not get notified — no `session:label-change` IPC yet) |
| 5 | DB and sidebar agree on session status | `session_list`, `sidebar_get_sessions` | For every test session, DB status matches sidebar status |

### 4. Sidebar Interaction

**File**: `tests/suites/sidebar-interaction.test.ts`
**What it verifies**: Session selection UI state and sidebar width control.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | selects a session | `sidebar_select_session`, `sidebar_get_selected` | Selected session ID matches the one we set |
| 2 | deselects with null | `sidebar_select_session`, `sidebar_get_selected` | Selected session ID becomes null |
| 3 | switches selection between sessions | `sidebar_select_session`, `sidebar_get_selected` | Selection changes correctly when switching between two sessions |
| 4 | gets sidebar width | `layout_get_sidebar_width` | Width is between 200–500px (valid range) |
| 5 | sets sidebar width and reads it back | `layout_set_sidebar_width`, `layout_get_sidebar_width` | Set to 350px, read back 350px, then restore original |

### 5. Detach Semantics

**File**: `tests/suites/detach-semantics.test.ts`
**What it verifies**: Closing a tile (detach) does NOT kill the session — a key UX distinction.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | removing tile does not kill the session | `layout_add_tile`, `layout_remove_tile`, `session_get_status` | Session remains `active` after its tile is removed |
| 2 | can re-add tile after detach | `layout_add_tile`, `layout_get_tile_count` | Tile count increases when re-adding a detached session |
| 3 | can kill a detached session | `layout_remove_tile`, `session_kill`, `session_wait_for_status`, `session_get_status` | A session with no tile can still be killed and transitions to `ended` |

### 6. Terminal I/O

**File**: `tests/suites/terminal-io.test.ts`
**What it verifies**: Basic terminal input/output — send commands, read buffer, check dimensions.

**Setup**: Creates a session and adds a tile (required for xterm.js to render the buffer).

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | sends keys and reads output | `terminal_send_keys`, `terminal_wait_for_content` | `echo hello-mcode-test` output appears in buffer |
| 2 | reads buffer with line limit | `terminal_read_buffer` | With `lines: 5`, returned text has at most 5 lines |
| 3 | gets terminal dimensions | `terminal_get_dimensions` | cols > 0, rows > 0 |

### 7. Terminal Advanced

**File**: `tests/suites/terminal-advanced.test.ts`
**What it verifies**: PTY resize, signal handling, timeout behavior, sequential command isolation.

**Setup**: Creates a session with a tile for xterm.js rendering.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | resizes terminal and verifies new dimensions | `terminal_resize`, `session_info` | Resize to 120x40 → both the resize response and `session_info` reflect new dimensions |
| 2 | sends Ctrl+C to interrupt a running command | `terminal_send_keys`, `terminal_wait_for_content` | `sleep 60` is interrupted by `\x03`; shell prompt (`$`) reappears |
| 3 | wait_for_content times out on non-matching pattern | `terminal_wait_for_content` | Returns `isError: true` with "Timeout" message after 1s |
| 4 | handles multiple sequential commands | `terminal_send_keys`, `terminal_wait_for_content` | Two sequential echo commands both appear in buffer; output is not mixed |

### 8. Window Tools

**File**: `tests/suites/window-tools.test.ts`
**What it verifies**: Electron window management — screenshot capture, bounds query, resize.

**Setup/teardown**: Saves original window bounds in `beforeAll`, restores them in `afterAll`.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | takes a screenshot | `window_screenshot` | Returns base64 PNG image content (gracefully skips in headless environments) |
| 2 | gets window bounds | `window_get_bounds` | Returns x, y (numbers), width > 0, height > 0 |
| 3 | resizes window and verifies | `window_resize`, `window_get_bounds` | Resize to 1200x800 (above macOS minimum), bounds match afterward |

### 9. App Introspection

**File**: `tests/suites/app-introspection.test.ts`
**What it verifies**: App metadata and renderer-side capture mechanisms.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | returns app version as non-empty string | `app_get_version` | Non-empty, matches semver pattern `X.Y.Z` |
| 2 | returns console logs as array | `app_get_console_logs` | Response is a valid array |
| 3 | filters console logs by level | `app_get_console_logs` | With `level: "error"`, every returned entry has `level === "error"` |
| 4 | respects console log limit | `app_get_console_logs` | With `limit: 3`, at most 3 entries returned |
| 5 | returns HMR events as array | `app_get_hmr_events` | Response is a valid array |

### 10. Error Cases

**File**: `tests/suites/error-cases.test.ts`
**What it verifies**: All tools return proper errors (not crashes) when given non-existent session IDs.

Uses a fake UUID `00000000-0000-0000-0000-000000000000` for all calls.

| # | Test | MCP tool | What it checks |
|---|------|----------|----------------|
| 1 | session_get_status error | `session_get_status` | isError is true |
| 2 | session_kill error | `session_kill` | isError is true |
| 3 | session_set_label error | `session_set_label` | isError is true |
| 4 | session_info error | `session_info` | isError is true |
| 5 | session_wait_for_status error | `session_wait_for_status` | isError is true (with 500ms timeout) |
| 6 | terminal_read_buffer error | `terminal_read_buffer` | isError is true |
| 7 | terminal_send_keys error | `terminal_send_keys` | isError is true |
| 8 | terminal_get_dimensions error | `terminal_get_dimensions` | isError is true |
| 9 | terminal_resize error | `terminal_resize` | isError is true |
| 10 | terminal_wait_for_content error | `terminal_wait_for_content` | isError is true (with 500ms timeout) |
| 11 | layout_add_tile error | `layout_add_tile` | isError is true |

### 11. Concurrent Sessions

**File**: `tests/suites/concurrent-sessions.test.ts`
**What it verifies**: The app handles 4 simultaneous sessions — creation, state tracking, independent I/O, and teardown.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | creates 4 sessions concurrently | `session_create` | All 4 created via `Promise.all`, all start with `starting` status |
| 2 | all sessions transition to active | `session_wait_for_status` | All 4 reach `active` concurrently |
| 3 | all sessions appear in session_list | `session_list` | All 4 IDs present with `active` status |
| 4 | all sessions have tiles auto-added | `layout_get_tree` | Layout tree JSON contains all 4 session IDs |
| 5 | all sessions appear in sidebar | `sidebar_get_sessions` | All 4 IDs present in sidebar Zustand store |
| 6 | each session has independent terminal I/O | `terminal_send_keys`, `terminal_wait_for_content` | Unique marker echoed to each session appears only in that session's buffer |
| 7 | kills all sessions and all transition to ended | `session_kill`, `session_wait_for_status`, `session_get_status` | All 4 reach `ended` with endedAt set |
| 8 | tile count returns to baseline after kills | `layout_get_tile_count` | Tile count is non-negative |

---

## Coverage Summary

| Feature Area | Suites | Tests | Key behaviors verified |
|-------------|--------|-------|----------------------|
| Session lifecycle | 1, 10, 11 | 22 | Create, status transitions, list, label, PTY info, kill, idempotent kill, concurrent create/kill, error on missing |
| Tiling layout | 2, 5, 11 | 14 | Auto-tile on create, add/remove, tree structure, detach != kill, re-attach, concurrent tiles |
| Sidebar | 3, 4 | 10 | Session display, status tracking, DB consistency, selection, width control |
| Terminal I/O | 6, 7, 10 | 12 | Send/read, buffer limits, dimensions, resize, Ctrl+C, timeout, sequential commands, error on missing |
| Window | 8 | 3 | Screenshot, bounds, resize |
| App introspection | 9 | 5 | Version, console logs (filter + limit), HMR events |
| **Total** | **11** | **60** | |

## Writing New Tests

1. Add a new file in `tests/suites/` with the `.test.ts` extension.
2. Use `McpTestClient` from `../mcp-client` and helpers from `../helpers`.
3. Always connect in `beforeAll` and disconnect in `afterAll`.
4. Clean up sessions in `afterAll` using `cleanupSessions()`.
5. If your test needs terminal buffer reads, add a tile first (`layout_add_tile`) — xterm.js only renders the buffer when a tile is mounted.
6. For tools with all-optional params, pass `{}` (not omit args) to satisfy MCP SDK validation.
