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
├── helpers.ts             # Composable test helpers (session, hook, task, layout)
├── suites/                # Test suites organized by feature area
│   ├── session-lifecycle  # Core session state machine
│   ├── session-delete     # Session deletion (single + bulk)
│   ├── tiling-layout      # Mosaic layout management
│   ├── layout-ui-controls # Sidebar collapse, dashboard/shortcuts toggle, remove-all
│   ├── sidebar-sessions   # Sidebar ↔ DB consistency
│   ├── sidebar-interaction # Selection and sidebar width
│   ├── detach-semantics   # Tile removal vs session kill
│   ├── terminal-io        # Basic terminal read/write
│   ├── terminal-advanced  # Resize, Ctrl+C, timeouts
│   ├── terminal-actions   # Execute actions (copy/clear), file drop
│   ├── window-tools       # Screenshot, bounds, resize
│   ├── app-introspection  # Version, console logs, HMR
│   ├── app-sleep          # Sleep prevention controls
│   ├── app-startup        # Renderer bridge readiness
│   ├── error-cases        # Error responses for invalid inputs
│   ├── concurrent-sessions # Multi-session stress test
│   ├── permission-modes   # CLI permission mode validation
│   ├── hook-config        # Hook config merge/remove logic (unit)
│   ├── hook-integration   # Hook event lifecycle, HTTP errors
│   ├── attention-system   # Attention levels, priority, clearing
│   ├── task-queue         # Task CRUD, dispatch, scheduling
│   └── commit-tracking    # Commit stats, heatmap, streaks, cadence
└── vitest.config.mts      # Sequential execution, 30s timeout
```

**Test client** (`tests/mcp-client.ts`): Thin wrapper around `@modelcontextprotocol/sdk` Client with `StreamableHTTPClientTransport`. Provides `callTool()` (raw result), `callToolJson<T>()` (auto-parse), and `callToolText()` (extract text).

**Helpers** (`tests/helpers.ts`): Composable building blocks that combine MCP tool calls:

*Session lifecycle:*
- `createTestSession(client, overrides?)` — creates a session with `command: "bash"`
- `createLiveClaudeTestSession(client, overrides?)` — creates a Claude session with `hookMode: 'live'` using the test fixture
- `waitForActive(client, sessionId, timeoutMs?)` — polls `session_wait_for_status` until active
- `killAndWaitEnded(client, sessionId)` — kills and waits for ended status
- `cleanupSessions(client, ids)` — best-effort kill all (used in afterAll)

*Hook system:*
- `injectHookEvent(client, sessionId, hookEventName, opts?)` — injects a synthetic hook event
- `waitForAttention(client, sessionId, attentionLevel, timeoutMs?)` — polls until attention level reached
- `getAttentionSummary(client)` — gets per-level attention counts and dock badge
- `getHookRuntime(client)` — gets hook runtime state (ready/degraded/initializing)
- `getRecentEvents(client, sessionId, limit?)` — lists recent hook events for a session
- `clearAttention(client, sessionId)` — clears attention for one session
- `clearAllAttention(client)` — clears attention for all sessions

*Sidebar:*
- `getSidebarSessions(client)` — lists sessions shown in sidebar
- `selectSession(client, sessionId)` — selects or deselects a session

*Task queue:*
- `createTask(client, overrides?)` — creates a task with default prompt and cwd
- `listTasks(client, filter?)` — lists tasks with optional status/session filters
- `cancelTask(client, taskId)` — cancels a pending task
- `waitForTaskStatus(client, taskId, status, timeoutMs?)` — polls until task reaches target status

*Layout:*
- `getTileCount(client)` — reads `layout_get_tile_count`

**Execution model**: All suites run sequentially (no parallelism) because they share a single Electron app instance. Each suite manages its own sessions via `beforeAll`/`afterAll` cleanup.

---

## MCP Tools Used

59 tools across 9 categories. Each test case lists the tools it exercises.

| Category | Tools |
|----------|-------|
| **Session** (9) | `session_create`, `session_list`, `session_get_status`, `session_kill`, `session_delete`, `session_delete_all_ended`, `session_info`, `session_wait_for_status`, `session_set_label` |
| **Terminal** (7) | `terminal_read_buffer`, `terminal_send_keys`, `terminal_get_dimensions`, `terminal_resize`, `terminal_execute_action`, `terminal_drop_files`, `terminal_wait_for_content` |
| **Layout** (12) | `layout_get_tree`, `layout_add_tile`, `layout_remove_tile`, `layout_remove_all_tiles`, `layout_get_tile_count`, `layout_get_sidebar_width`, `layout_set_sidebar_width`, `layout_get_sidebar_collapsed`, `layout_set_sidebar_collapsed`, `layout_toggle_keyboard_shortcuts`, `layout_toggle_dashboard`, `sidebar_get_sessions` |
| **Sidebar** (3) | `sidebar_select_session`, `sidebar_get_selected`, `sidebar_get_tasks` |
| **Window** (3) | `window_screenshot`, `window_get_bounds`, `window_resize` |
| **App** (5) | `app_get_version`, `app_get_console_logs`, `app_get_hmr_events`, `app_get_sleep_blocker_status`, `app_set_prevent_sleep` |
| **Hook** (8) | `app_get_hook_runtime`, `app_get_attention_summary`, `hook_inject_event`, `hook_list_recent`, `hook_list_recent_all`, `session_wait_for_attention`, `session_clear_attention`, `session_clear_all_attention` |
| **Task** (4) | `task_create`, `task_list`, `task_cancel`, `task_wait_for_status` |
| **Commits** (8) | `commits_get_daily_stats`, `commits_get_heatmap`, `commits_get_streaks`, `commits_get_cadence`, `commits_get_weekly_trend`, `commits_refresh`, `commits_get_scan_mode`, `commits_set_scan_mode` |

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

### 2. Session Delete

**File**: `tests/suites/session-delete.test.ts`
**What it verifies**: Deleting ended sessions — single and bulk deletion, validation that active sessions cannot be deleted.

**Setup**: Creates 3 sessions, kills 2 to make them "ended", keeps 1 active.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | deletes an ended session | `session_delete`, `session_get_status` | Deletion succeeds; subsequent get returns `isError: true` |
| 2 | rejects deleting an active session | `session_delete` | `isError: true` for active session |
| 3 | delete_all_ended removes all ended sessions | `session_delete_all_ended`, `session_list` | Returns count; deleted IDs gone from list |
| 4 | delete_all_ended is safe when no ended sessions exist | `session_delete_all_ended` | Returns "No ended sessions to delete" |

### 3. Tiling Layout

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

### 4. Layout UI Controls

**File**: `tests/suites/layout-ui-controls.test.ts`
**What it verifies**: Sidebar collapse, dashboard/keyboard-shortcuts toggle, and bulk tile removal.

**Setup**: Creates 2 sessions with tiles, saves original sidebar collapsed state.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | remove_all_tiles empties the layout | `layout_remove_all_tiles`, `layout_get_tile_count` | Tile count becomes 0 |
| 2 | sessions survive remove_all_tiles | `session_get_status` | Both sessions still `active` |
| 3 | can re-add tiles after remove_all | `layout_add_tile`, `layout_get_tile_count` | Count increases back |
| 4 | get/set sidebar collapsed round-trips | `layout_get_sidebar_collapsed`, `layout_set_sidebar_collapsed` | Set true → read true; set false → read false; restore original |
| 5 | toggle_keyboard_shortcuts toggles state | `layout_toggle_keyboard_shortcuts` | Two calls return opposite booleans (net zero change) |
| 6 | toggle_dashboard toggles and affects tile count | `layout_toggle_dashboard`, `layout_get_tile_count` | Tile count changes; second toggle restores |
| 7 | remove_all_tiles is idempotent | `layout_remove_all_tiles`, `layout_get_tile_count` | No error when already 0 tiles |

### 5. Sidebar Sessions

**File**: `tests/suites/sidebar-sessions.test.ts`
**What it verifies**: Sidebar Zustand store reflects DB state — session appearance, status tracking, label persistence.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | shows created session in sidebar | `session_create`, `sidebar_get_sessions` | Newly created session appears in sidebar list |
| 2 | sidebar shows active status after transition | `session_wait_for_status`, `sidebar_get_sessions` | Sidebar entry shows `active` after PTY starts |
| 3 | sidebar shows ended status after kill | `session_kill`, `session_wait_for_status`, `sidebar_get_sessions` | Sidebar entry shows `ended` after kill |
| 4 | set label persists to DB | `session_create`, `session_wait_for_status`, `session_set_label`, `session_get_status` | Label change via MCP persists in SQLite (note: sidebar Zustand store does not get notified — no `session:label-change` IPC yet) |
| 5 | DB and sidebar agree on session status | `session_list`, `sidebar_get_sessions` | For every test session, DB status matches sidebar status |

### 6. Sidebar Interaction

**File**: `tests/suites/sidebar-interaction.test.ts`
**What it verifies**: Session selection UI state and sidebar width control.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | selects a session | `sidebar_select_session`, `sidebar_get_selected` | Selected session ID matches the one we set |
| 2 | deselects with null | `sidebar_select_session`, `sidebar_get_selected` | Selected session ID becomes null |
| 3 | switches selection between sessions | `sidebar_select_session`, `sidebar_get_selected` | Selection changes correctly when switching between two sessions |
| 4 | gets sidebar width | `layout_get_sidebar_width` | Width is between 200–500px (valid range) |
| 5 | sets sidebar width and reads it back | `layout_set_sidebar_width`, `layout_get_sidebar_width` | Set to 350px, read back 350px, then restore original |

### 7. Detach Semantics

**File**: `tests/suites/detach-semantics.test.ts`
**What it verifies**: Closing a tile (detach) does NOT kill the session — a key UX distinction.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | removing tile does not kill the session | `layout_add_tile`, `layout_remove_tile`, `session_get_status` | Session remains `active` after its tile is removed |
| 2 | can re-add tile after detach | `layout_add_tile`, `layout_get_tile_count` | Tile count increases when re-adding a detached session |
| 3 | can kill a detached session | `layout_remove_tile`, `session_kill`, `session_wait_for_status`, `session_get_status` | A session with no tile can still be killed and transitions to `ended` |

### 8. Terminal I/O

**File**: `tests/suites/terminal-io.test.ts`
**What it verifies**: Basic terminal input/output — send commands, read buffer, check dimensions.

**Setup**: Creates a session and adds a tile (required for xterm.js to render the buffer).

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | sends keys and reads output | `terminal_send_keys`, `terminal_wait_for_content` | `echo hello-mcode-test` output appears in buffer |
| 2 | reads buffer with line limit | `terminal_read_buffer` | With `lines: 5`, returned text has at most 5 lines |
| 3 | gets terminal dimensions | `terminal_get_dimensions` | cols > 0, rows > 0 |

### 9. Terminal Advanced

**File**: `tests/suites/terminal-advanced.test.ts`
**What it verifies**: PTY resize, signal handling, timeout behavior, sequential command isolation.

**Setup**: Creates a session with a tile for xterm.js rendering.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | resizes terminal and verifies new dimensions | `terminal_resize`, `session_info` | Resize to 120x40 → both the resize response and `session_info` reflect new dimensions |
| 2 | sends Ctrl+C to interrupt a running command | `terminal_send_keys`, `terminal_wait_for_content` | `sleep 60` is interrupted by `\x03`; shell prompt (`$`) reappears |
| 3 | wait_for_content times out on non-matching pattern | `terminal_wait_for_content` | Returns `isError: true` with "Timeout" message after 1s |
| 4 | handles multiple sequential commands | `terminal_send_keys`, `terminal_wait_for_content` | Two sequential echo commands both appear in buffer; output is not mixed |

### 10. Terminal Actions

**File**: `tests/suites/terminal-actions.test.ts`
**What it verifies**: Terminal execute actions (selectAll, copy, clear) and file drop simulation.

**Setup**: Creates a session with a tile for xterm.js rendering.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | clear removes scrollback | `terminal_send_keys`, `terminal_wait_for_content`, `terminal_execute_action`, `terminal_read_buffer` | Buffer no longer contains marker after clear |
| 2 | selectAll + copy returns buffer content | `terminal_send_keys`, `terminal_wait_for_content`, `terminal_execute_action` | Copy after selectAll contains echoed marker |
| 3 | drop_files writes path to terminal | `terminal_drop_files`, `terminal_read_buffer` | Dropped `package.json` path appears in buffer |

### 11. Window Tools

**File**: `tests/suites/window-tools.test.ts`
**What it verifies**: Electron window management — screenshot capture, bounds query, resize.

**Setup/teardown**: Saves original window bounds in `beforeAll`, restores them in `afterAll`.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | takes a screenshot | `window_screenshot` | Returns base64 PNG image content (gracefully skips in headless environments) |
| 2 | gets window bounds | `window_get_bounds` | Returns x, y (numbers), width > 0, height > 0 |
| 3 | resizes window and verifies | `window_resize`, `window_get_bounds` | Resize to 1200x800 (above macOS minimum), bounds match afterward |

### 12. App Introspection

**File**: `tests/suites/app-introspection.test.ts`
**What it verifies**: App metadata and renderer-side capture mechanisms.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | returns app version as non-empty string | `app_get_version` | Non-empty, matches semver pattern `X.Y.Z` |
| 2 | returns console logs as array | `app_get_console_logs` | Response is a valid array |
| 3 | filters console logs by level | `app_get_console_logs` | With `level: "error"`, every returned entry has `level === "error"` |
| 4 | respects console log limit | `app_get_console_logs` | With `limit: 3`, at most 3 entries returned |
| 5 | returns HMR events as array | `app_get_hmr_events` | Response is a valid array |

### 13. App Sleep Prevention

**File**: `tests/suites/app-sleep.test.ts`
**What it verifies**: Sleep prevention controls — enable, disable, status query, idempotent toggling.

**Setup/teardown**: Saves original enabled state in `beforeAll`, restores in `afterAll`.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | get_sleep_blocker_status returns valid shape | `app_get_sleep_blocker_status` | Has `enabled` (boolean) and `blocking` (boolean) |
| 2 | set_prevent_sleep enables sleep prevention | `app_set_prevent_sleep`, `app_get_sleep_blocker_status` | enabled → true |
| 3 | set_prevent_sleep disables sleep prevention | `app_set_prevent_sleep`, `app_get_sleep_blocker_status` | enabled → false |
| 4 | toggling is idempotent | `app_set_prevent_sleep` | Set true twice, no error, still enabled |

### 14. App Startup

**File**: `tests/suites/app-startup.test.ts`
**What it verifies**: Renderer bridge responds after app startup.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | responds to renderer bridge queries after startup | `app_get_console_logs` | Returns valid array, every entry has `args` array |

### 15. Error Cases

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
| 12 | session_delete error | `session_delete` | isError is true |
| 13 | terminal_execute_action error | `terminal_execute_action` | isError is true |
| 14 | terminal_drop_files error | `terminal_drop_files` | isError is true |

### 16. Concurrent Sessions

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

### 17. Permission Modes

**File**: `tests/suites/permission-modes.test.ts`
**What it verifies**: Our `PERMISSION_MODES` constant stays in sync with the Claude CLI's accepted `--permission-mode` values.

**Note**: This suite does not use MCP tools — it runs `claude --permission-mode __invalid__` and parses the CLI error to extract valid modes.

| # | Test | What it checks |
|---|------|----------------|
| 1 | PERMISSION_MODES matches Claude CLI allowed choices | Parses "Allowed choices are ..." from CLI error; verifies our constant has no missing or extra modes |

### 18. Hook Config

**File**: `tests/suites/hook-config.test.ts`
**What it verifies**: Pure unit tests for hook config merging and removal logic (no MCP server needed).

| # | Test | What it checks |
|---|------|----------------|
| 1 | merges mcode hooks using Claude hook groups | Existing user hooks preserved; mcode hooks appended with correct URL, headers, and `allowedHttpHookUrls` |
| 2 | removes only mcode-owned hooks and preserves user hooks | Hooks with `X-Mcode-Hook` header removed; user hooks untouched; empty groups pruned |

### 19. Hook Integration

**File**: `tests/suites/hook-integration.test.ts`
**What it verifies**: Hook event processing lifecycle — event injection, status transitions, attention levels, event persistence, and HTTP error responses.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | hook runtime is ready or degraded, never initializing | `app_get_hook_runtime` | State is `ready` or `degraded`, not `initializing` |
| 2 | SessionStart transitions to active | `hook_inject_event`, `session_create`, `session_wait_for_status` | Status becomes `active`, claudeSessionId is set |
| 3 | PreToolUse updates lastTool | `hook_inject_event` | `lastTool` reflects the tool name |
| 4 | PostToolUse stays active | `hook_inject_event` | Status remains `active` |
| 5 | Stop transitions to idle with low attention | `hook_inject_event` | Status `idle`, attention `low` |
| 6 | PermissionRequest transitions to waiting with high attention | `hook_inject_event` | Status `waiting`, attention `high`, reason contains tool name |
| 7 | PostToolUse returns to active but attention stays high | `hook_inject_event` | Status `active`, attention `high` |
| 8 | SessionEnd transitions to ended and clears attention | `hook_inject_event`, `session_create`, `session_wait_for_status` | Status `ended`, attention `none` |
| 9 | events are persisted and retrievable | `hook_list_recent` | Events list is non-empty, contains correct sessionId |
| 10 | POST garbage to hook server returns 400 | direct HTTP fetch | 400 status on malformed JSON (skipped if runtime not ready) |
| 11 | valid JSON but unknown event name returns 400 | direct HTTP fetch | 400 for `MadeUpEvent` |
| 12 | valid event but unknown session returns 404 | direct HTTP fetch | 404 for nonexistent session header |
| 13 | Stop when already idle does not change attention | `hook_inject_event`, `session_clear_attention`, `session_get_status` | Second Stop on idle session with cleared attention keeps attention `none` |
| 14 | PTY exit transitions to ended and clears attention | `session_kill`, `session_wait_for_status` | Status `ended`, attention `none` after kill |
| 15 | hook_list_recent_all returns events across sessions | `hook_list_recent_all` | Non-empty array with events from multiple sessions |

### 20. Attention System

**File**: `tests/suites/attention-system.test.ts`
**What it verifies**: Attention level assignment, priority ordering, clearing, and sidebar sorting by attention.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | PermissionRequest sets high attention | `hook_inject_event` | attention `high`, status `waiting` |
| 2 | attention summary reports one high session | `app_get_attention_summary` | `high >= 1`, dockBadge truthy |
| 3 | Notification sets medium attention on another session | `hook_inject_event` | attention `medium`, status `active` |
| 4 | Stop sets low attention on a third session | `hook_inject_event` | attention `low`, status `idle` |
| 5 | clear_attention clears one session without changing status | `session_clear_attention` | attention `none`, status unchanged |
| 6 | clear_all_attention clears all sessions | `session_clear_all_attention`, `app_get_attention_summary` | all counts zero |
| 7 | high attention is not overridden by medium events | `hook_inject_event` | attention stays `high` after Notification |
| 8 | PostToolUseFailure sets medium attention | `hook_inject_event` | attention `medium`, reason contains tool name |
| 9 | user selection clears attention for that session only | `sidebar_select_session`, `session_get_status` | selected session cleared, other unchanged |
| 10 | sidebar sorts sessions by attention level (high first) | `sidebar_get_sessions` | high index < medium index < low index |

### 21. Task Queue

**File**: `tests/suites/task-queue.test.ts`
**What it verifies**: Task CRUD, dispatch to sessions, failure handling, scheduled tasks, and validation.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | creates a task with pending status | `task_create`, `task_cancel` | id > 0, status `pending`, fields populated |
| 2 | lists tasks with filters | `task_create`, `task_list`, `task_cancel` | Both tasks in list, higher priority first |
| 3 | cancels a pending task | `task_create`, `task_cancel`, `task_list` | Cancelled task absent from list |
| 4 | rejects cancellation of non-pending tasks | `task_create`, `task_wait_for_status`, `task_cancel` | Throws `/only pending/i` for dispatched task |
| 5 | dispatches task to existing idle session | `task_create`, `task_wait_for_status`, `hook_inject_event` | sessionId set, completedAt non-null |
| 6 | dispatches tasks sequentially on same session | `task_create`, `task_wait_for_status`, `hook_inject_event` | Three tasks dispatched and completed in order |
| 7 | fails task when target session ends | `task_create`, `task_wait_for_status`, `session_kill` | Both tasks status `failed`, error truthy |
| 8 | creates a scheduled task that waits | `task_create`, `task_list`, `task_cancel` | Remains `pending` after 3s wait |
| 9 | rejects task creation when hook runtime is not ready | `task_create` | Throws `/not found/i` for nonexistent session |
| 10 | rejects task targeting terminal session | `task_create`, `session_create` | Throws `/only supports Claude/i` |
| 11 | rejects task targeting ended session | `task_create`, `session_kill` | Throws `/ended/i` |
| 12 | sidebar_get_tasks returns all tasks | `sidebar_get_tasks`, `task_create`, `task_cancel` | Created task appears in sidebar list |
| 13 | rejects task targeting fallback-mode Claude session | `task_create`, `session_create` | Throws `/live hook mode/i` |

### 22. Commit Tracking

**File**: `tests/suites/commit-tracking.test.ts`
**What it verifies**: Commit statistics, heatmap, streaks, cadence, weekly trend, and scan mode controls.

**Setup**: Calls `commits_refresh` to ensure tracker has data. **Teardown**: Restores original scan mode.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | commits_refresh completes | `commits_refresh` | Response contains "Scan complete" |
| 2 | get_daily_stats returns valid shape | `commits_get_daily_stats` | Has `total`, `claude`, `solo` (numbers ≥ 0), `repos` (array) |
| 3 | get_daily_stats accepts date parameter | `commits_get_daily_stats` | Far past date (2020-01-01) → total 0 |
| 4 | get_heatmap returns array of entries | `commits_get_heatmap` | Default 7 entries, each has `date` and `count` |
| 5 | get_heatmap respects days parameter | `commits_get_heatmap` | days: 3 → 3 entries |
| 6 | get_streaks returns streak info | `commits_get_streaks` | Has `current`, `longest` (numbers ≥ 0) |
| 7 | get_cadence returns cadence info | `commits_get_cadence` | Has `averageMinutesBetween`, `peakHour`, `distribution` |
| 8 | get_weekly_trend returns trend info | `commits_get_weekly_trend` | Has `thisWeek`, `lastWeek`, `percentChange` |
| 9 | get_scan_mode returns current mode | `commits_get_scan_mode` | Has `scanAllBranches` boolean |
| 10 | set_scan_mode round-trips correctly | `commits_set_scan_mode`, `commits_get_scan_mode` | Toggle, verify change, restore original |

---

## Coverage Summary

| Feature Area | Suites | Tests | Key behaviors verified |
|-------------|--------|-------|----------------------|
| Session lifecycle | 1, 2, 15, 16 | 25 | Create, status transitions, list, label, PTY info, kill, delete, bulk delete, idempotent kill, concurrent create/kill, error on missing |
| Tiling layout | 3, 4, 7, 16 | 19 | Auto-tile on create, add/remove, remove-all, tree structure, detach != kill, re-attach, concurrent tiles |
| Sidebar | 5, 6 | 10 | Session display, status tracking, DB consistency, selection, width control |
| Terminal I/O | 8, 9, 10, 15 | 13 | Send/read, buffer limits, dimensions, resize, Ctrl+C, timeout, sequential commands, copy/selectAll/clear, file drop, error on missing |
| Window | 11 | 3 | Screenshot, bounds, resize |
| App introspection | 12, 13, 14 | 10 | Version, console logs (filter + limit), HMR events, sleep prevention, renderer bridge |
| Permission modes | 17 | 1 | PERMISSION_MODES constant matches Claude CLI |
| Hook config | 18 | 2 | Merge/remove mcode hooks, preserve user hooks |
| Hook integration | 19 | 15 | Event lifecycle (all hook events), status transitions, event persistence, HTTP error responses, PTY exit, cross-session events |
| Attention system | 20 | 10 | Attention levels (high/medium/low), priority ordering, clearing, sidebar sorting |
| Task queue | 21 | 13 | Task CRUD, dispatch, sequential dispatch, failure on session end, scheduling, validation |
| Commit tracking | 22 | 10 | Daily stats, heatmap, streaks, cadence, weekly trend, scan mode |
| **Total** | **22** | **133** | |

## Writing New Tests

1. Add a new file in `tests/suites/` with the `.test.ts` extension.
2. Use `McpTestClient` from `../mcp-client` and helpers from `../helpers`.
3. Always connect in `beforeAll` and disconnect in `afterAll`.
4. Clean up sessions in `afterAll` using `cleanupSessions()`.
5. If your test needs terminal buffer reads, add a tile first (`layout_add_tile`) — xterm.js only renders the buffer when a tile is mounted.
6. For tools with all-optional params, pass `{}` (not omit args) to satisfy MCP SDK validation.
