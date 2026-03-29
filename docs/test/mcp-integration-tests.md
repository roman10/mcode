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

# Point the test client at a different MCP server
MCODE_TEST_URL=http://127.0.0.1:7532/mcp npm run test:mcp
```

The test client defaults to `http://127.0.0.1:7532/mcp` and respects `MCODE_TEST_URL` when you need to target a different dev instance.

All suites run sequentially against a single shared Electron app instance. `vitest.config.mts` disables file parallelism and concurrent sequencing, so suite-level isolation depends on helpers like `resetTestState()` and `cleanupSessions()`.

## Architecture

```
tests/
├── mcp-client.ts          # MCP SDK client wrapper (connects to localhost:7532)
├── helpers.ts             # Composable test helpers (session, hook, task, layout, kanban, file, sidebar)
├── fixtures/
│   ├── claude             # Fake Claude CLI used by live hook-mode integration tests
│   ├── codex              # Fake Codex CLI used by Codex session integration tests
│   └── gemini             # Fake Gemini CLI used by Gemini session integration tests
├── suites/                # Test suites organized by feature area
│   ├── session-lifecycle  # Core session state machine
│   ├── session-delete     # Session deletion (single, bulk, batch)
│   ├── tiling-layout      # Mosaic layout management
│   ├── kanban-layout      # Kanban board view mode
│   ├── layout-ui-controls # Sidebar collapse, command palette/shortcuts toggle, remove-all
│   ├── sidebar-sessions   # Sidebar ↔ DB consistency
│   ├── sidebar-interaction # Selection and sidebar width
│   ├── sidebar-tabs       # Sidebar tab switching
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
│   ├── task-queue         # Task CRUD, update, dispatch, scheduling
│   ├── commit-tracking    # Commit stats, heatmap, streaks, cadence
│   ├── file-tools         # File list, read, write, viewer, quick open
│   ├── file-search        # File search (query, regex, case-sensitive, maxResults)
│   ├── token-usage        # Token usage stats, heatmap, trends
│   ├── git-tools          # Git status, diff content, diff viewer
│   ├── snippet-tools      # Snippet scanning, frontmatter parsing, variable extraction
│   ├── session-account    # Session account assignment (null vs explicit accountId)
│   ├── session-label-source # User labels vs auto-generated labels
│   ├── session-model      # Session model persistence and updates
│   ├── session-detach-restore # Detach/reconcile cycle preserving session state & attention
│   ├── sidebar-session-filter # Sidebar search filter set/get/clear
│   ├── stress-sessions    # 10 concurrent sessions stress test
│   ├── task-concurrent-dispatch # Parallel task dispatch to multiple sessions
│   ├── layout-no-page-scroll  # Page scroll prevention
│   ├── auto-mode              # enableAutoMode flag persistence (claude vs terminal sessions)
│   ├── codex-support          # Codex session creation, argv handling, sidebar/kanban visibility
│   ├── codex-resume           # Codex session resume in place via recorded thread ID
│   └── terminal-panel-resize  # Terminal panel height → xterm resize propagation

vitest.config.mts              # Sequential execution, 30s timeout (repo root)
```

**Test client** (`tests/mcp-client.ts`): Thin wrapper around `@modelcontextprotocol/sdk` Client with `StreamableHTTPClientTransport`. Provides `callTool()` (raw result), `callToolJson<T>()` (auto-parse), and `callToolText()` (extract text).

**Helpers** (`tests/helpers.ts`): Composable building blocks that combine MCP tool calls:

*Test isolation:*
- `resetTestState(client)` — calls `app_reset_test_state` to reset app to clean state before suites that mutate shared app state

*Session lifecycle:*
- `createTestSession(client, overrides?)` — creates a session with `command: "bash"`
- `createLiveClaudeTestSession(client, overrides?)` — creates a Claude session with `hookMode: 'live'` using the test fixture
- `createCodexTestSession(client, overrides?)` — creates a Codex session using the `tests/fixtures/codex` fake CLI
- `createGeminiTestSession(client, overrides?)` — creates a Gemini session using the `tests/fixtures/gemini` fake CLI
- `waitForActive(client, sessionId, timeoutMs?)` — polls `session_wait_for_status` until active
- `waitForIdle(client, sessionId, timeoutMs?)` — polls `session_wait_for_status` until idle
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
- `getSidebarSelected(client)` — gets the currently selected sidebar session ID
- `getSidebarActiveTab(client)` — gets the currently active sidebar tab
- `switchSidebarTab(client, tab)` — switches sidebar to a specific tab
- `setSessionFilter(client, query)` — sets sidebar filter via `sidebar_set_session_filter`
- `getSessionFilter(client)` — gets current filter query via `sidebar_get_session_filter`

*Task queue:*
- `createTask(client, overrides?)` — creates a task with default prompt and cwd
- `listTasks(client, filter?)` — lists tasks with optional status/session filters
- `cancelTask(client, taskId)` — cancels a pending task
- `waitForTaskStatus(client, taskId, status, timeoutMs?)` — polls until task reaches target status
- `updateTask(client, taskId, updates)` — updates a pending task's prompt, priority, or scheduledAt
- `reorderTask(client, taskId, direction)` — reorders a pending task up or down via `task_reorder`

*Layout:*
- `getTileCount(client)` — reads `layout_get_tile_count`
- `waitForTileCount(client, expected, timeoutMs?)` — polls `layout_wait_for_tile_count` until match
- `waitForViewMode(client, expected, timeoutMs?)` — polls `layout_wait_for_view_mode` until match

*Kanban:*
- `getViewMode(client)` — gets current view mode (tiles or kanban)
- `setViewMode(client, mode)` — switches view mode
- `getKanbanState(client)` — gets kanban board state (columns and expandedSessionId)
- `expandKanbanSession(client, sessionId)` — expands a session in kanban view
- `collapseKanban(client)` — collapses expanded kanban session
- `waitForKanbanColumn(client, sessionId, column, timeoutMs?)` — polls until session appears in column
- `waitForKanbanCollapse(client, timeoutMs?)` — polls until expandedSessionId is null

*File:*
- `writeTestFile(client, relativePath, content, cwd?)` — writes a file via `file_write`

**Execution model**: All suites run sequentially (no parallelism) because they share a single Electron app instance. Each suite manages its own sessions via `beforeAll`/`afterAll` cleanup.

## Fixtures And Troubleshooting

`createLiveClaudeTestSession()` uses `tests/fixtures/claude`, `createCodexTestSession()` uses `tests/fixtures/codex`, `createGeminiTestSession()` uses `tests/fixtures/gemini`, and `createCopilotTestSession()` uses `tests/fixtures/copilot`. These are fake CLI entrypoints for deterministic integration tests, so if they are missing or not executable the related suite setup will fail before the product code is exercised.

Common failure modes:

- MCP server unavailable: start `npm run dev` and wait for the MCP listener log line before running suites.
- Wrong target instance: set `MCODE_TEST_URL` explicitly when you are not using the default local server URL.
- Cross-suite leakage: call `resetTestState(client)` in `beforeAll` for suites that change global UI or app state, and always clean up created sessions in `afterAll` or `afterEach`.
- Empty terminal reads: add a tile before asserting on xterm output because the terminal buffer is only rendered when a tile is mounted.

---

## MCP Tools Used

101 tools across 16 categories. Each test case lists the tools it exercises.

| Category | Tools |
|----------|-------|
| **Session** (10) | `session_create`, `session_list`, `session_get_status`, `session_kill`, `session_delete`, `session_delete_all_ended`, `session_delete_batch`, `session_info`, `session_wait_for_status`, `session_set_label` |
| **Account** (1) | `account_list` |
| **Terminal** (9) | `terminal_read_buffer`, `terminal_send_keys`, `terminal_get_dimensions`, `terminal_resize`, `terminal_execute_action`, `terminal_drop_files`, `terminal_wait_for_content`, `terminal_panel_set_height`, `terminal_panel_get_dimensions` |
| **Layout** (15) | `layout_get_tree`, `layout_add_tile`, `layout_remove_tile`, `layout_remove_all_tiles`, `layout_get_tile_count`, `layout_get_sidebar_width`, `layout_set_sidebar_width`, `layout_get_sidebar_collapsed`, `layout_set_sidebar_collapsed`, `layout_toggle_keyboard_shortcuts`, `layout_toggle_command_palette`, `layout_wait_for_tile_count`, `layout_wait_for_view_mode`, `layout_get_view_mode`, `layout_set_view_mode` |
| **Sidebar** (7) | `sidebar_get_sessions`, `sidebar_select_session`, `sidebar_get_selected`, `sidebar_switch_tab`, `sidebar_get_active_tab`, `sidebar_set_session_filter`, `sidebar_get_session_filter` |
| **Kanban** (3) | `kanban_get_columns`, `kanban_expand_session`, `kanban_collapse` |
| **Window** (4) | `window_screenshot`, `window_get_bounds`, `window_resize`, `window_execute_js` |
| **App** (8) | `app_get_version`, `app_get_console_logs`, `app_get_hmr_events`, `app_get_sleep_blocker_status`, `app_set_prevent_sleep`, `app_reset_test_state`, `app_detach_all`, `app_reconcile_detached` |
| **Hook** (9) | `app_get_hook_runtime`, `app_get_attention_summary`, `hook_inject_event`, `hook_list_recent`, `hook_list_recent_all`, `hook_clear_all_events`, `session_wait_for_attention`, `session_clear_attention`, `session_clear_all_attention` |
| **Task** (6) | `task_create`, `task_list`, `task_cancel`, `task_update`, `task_wait_for_status`, `task_reorder` |
| **Commits** (9) | `commits_get_daily_stats`, `commits_get_heatmap`, `commits_get_streaks`, `commits_get_cadence`, `commits_get_weekly_trend`, `commits_refresh`, `commits_force_rescan`, `commits_get_scan_mode`, `commits_set_scan_mode` |
| **File** (5) | `file_list`, `file_read`, `file_write`, `file_open_viewer`, `quick_open_toggle` |
| **Search** (1) | `file_search` |
| **Token** (6) | `tokens_get_session_usage`, `tokens_get_daily_usage`, `tokens_get_model_breakdown`, `tokens_get_weekly_trend`, `tokens_get_heatmap`, `tokens_refresh` |
| **Git** (10) | `git_get_status`, `git_get_all_statuses`, `git_get_diff_content`, `git_stage_file`, `git_unstage_file`, `git_discard_file`, `git_stage_all`, `git_unstage_all`, `git_discard_all`, `git_open_diff_viewer` |
| **Snippet** (1) | `snippet_list` |

---

## Test Suites

### 1. Session Lifecycle

**File**: `tests/suites/session-lifecycle.test.ts`
**What it verifies**: The core session state machine — creation, status transitions, metadata, and teardown.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | starts with starting status | `session_create` | sessionId is UUID format, status is `starting`, startedAt is set, endedAt is null |
| 2 | transitions from starting to active | `session_wait_for_status` | Status becomes `active` after PTY emits first data |
| 3 | appears in session list | `session_list` | The created session is present in the full list with `active` status |
| 4 | can set label | `session_set_label`, `session_get_status` | Label update returns new label; re-reading from DB confirms persistence |
| 5 | has PTY info with valid pid and dimensions | `session_info` | pid > 0, cols > 0, rows > 0 |
| 6 | kills session and transitions to ended | `session_kill`, `session_wait_for_status`, `session_get_status` | Status becomes `ended`, endedAt is set |
| 7 | double kill is safe (idempotent) | `session_kill` | Second kill on already-ended session does not error |

### 2. Session Delete

**File**: `tests/suites/session-delete.test.ts`
**What it verifies**: Deleting ended sessions — single, bulk, and batch deletion, validation that active sessions cannot be deleted.

**Setup**: Creates 3 sessions, kills 2 to make them "ended", keeps 1 active.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | deletes an ended session | `session_delete`, `session_get_status` | Deletion succeeds; subsequent get returns `isError: true` |
| 2 | rejects deleting an active session | `session_delete` | `isError: true` for active session |
| 3 | delete_all_ended removes all ended sessions | `session_delete_all_ended`, `session_list` | Returns count; deleted IDs gone from list |
| 4 | delete_all_ended is safe when no ended sessions exist | `session_delete_all_ended` | Returns "No ended sessions to delete" |
| 5 | deletes a batch of ended sessions | `session_delete_batch`, `session_get_status` | Batch delete 2 ended sessions; both return `isError: true` on subsequent get |
| 6 | skips active sessions in the batch | `session_delete_batch`, `session_get_status` | Batch with 1 ended + 1 active: only ended deleted, active session survives |
| 7 | returns message for no valid IDs | `session_delete_batch` | Nonexistent IDs → "No valid ended sessions" |

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
| 7 | auto-closes tile when session is killed | `session_create`, `session_wait_for_status`, `session_kill`, `layout_wait_for_tile_count`, `layout_get_tile_count` | Tile count returns to baseline after kill |

### 4. Kanban Layout

**File**: `tests/suites/kanban-layout.test.ts`
**What it verifies**: Kanban board view mode — view mode switching, column grouping by session state, session expansion, and auto-collapse behavior.

**Setup/teardown**: Saves original view mode in `beforeAll`, restores in `afterAll`.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | switches view mode to kanban and back | `layout_get_view_mode`, `layout_set_view_mode` | Set kanban → read kanban; set tiles → read tiles |
| 2 | groups active sessions into the working column | `kanban_get_columns` | Active session appears in `working` column |
| 3 | moves ended sessions to the completed column | `kanban_get_columns` | Killed session appears in `completed` column |
| 4 | moves sessions with action attention to needs-attention column | `kanban_get_columns`, `hook_inject_event` | PermissionRequest → session in `needs-attention` column |
| 5 | expands a session and reports expandedSessionId | `kanban_expand_session`, `kanban_get_columns`, `kanban_collapse` | expandedSessionId matches; collapse clears it |
| 6 | auto-collapses when expanded session is killed | `kanban_expand_session`, `kanban_get_columns`, `session_kill` | expandedSessionId becomes null after kill |
| 7 | clears expansion when switching view modes | `layout_set_view_mode`, `kanban_get_columns` | Switch tiles→kanban clears expandedSessionId |
| 8 | maintains tile tree in kanban mode | `layout_get_tile_count` | Tile count still increments when creating sessions in kanban mode |

### 5. Layout UI Controls

**File**: `tests/suites/layout-ui-controls.test.ts`
**What it verifies**: Sidebar collapse, command palette/keyboard-shortcuts toggle, and bulk tile removal.

**Setup**: Creates 2 sessions with tiles, saves original sidebar collapsed state.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | remove_all_tiles empties the layout | `layout_remove_all_tiles`, `layout_get_tile_count` | Tile count becomes 0 |
| 2 | sessions survive remove_all_tiles | `session_get_status` | Both sessions still `active` |
| 3 | can re-add tiles after remove_all | `layout_add_tile`, `layout_get_tile_count` | Count increases back |
| 4 | get/set sidebar collapsed round-trips | `layout_get_sidebar_collapsed`, `layout_set_sidebar_collapsed` | Set true → read true; set false → read false; restore original |
| 5 | toggle_keyboard_shortcuts toggles state | `layout_toggle_keyboard_shortcuts` | Two calls return opposite booleans (net zero change) |
| 6 | toggle_command_palette toggles state | `layout_toggle_command_palette` | Two calls return opposite booleans (net zero change) |
| 7 | remove_all_tiles is idempotent | `layout_remove_all_tiles`, `layout_get_tile_count` | No error when already 0 tiles |

### 6. Sidebar Sessions

**File**: `tests/suites/sidebar-sessions.test.ts`
**What it verifies**: Sidebar Zustand store reflects DB state — session appearance, status tracking, label persistence.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | shows created session in sidebar | `session_create`, `sidebar_get_sessions` | Newly created session appears in sidebar list |
| 2 | sidebar shows active status after transition | `session_wait_for_status`, `sidebar_get_sessions` | Sidebar entry shows `active` after PTY starts |
| 3 | sidebar shows ended status after kill | `session_kill`, `session_wait_for_status`, `sidebar_get_sessions` | Sidebar entry shows `ended` after kill |
| 4 | set label persists to DB | `session_create`, `session_wait_for_status`, `session_set_label`, `session_get_status` | Label change via MCP persists in SQLite (note: sidebar Zustand store does not get notified — no `session:label-change` IPC yet) |
| 5 | DB and sidebar agree on session status | `session_list`, `sidebar_get_sessions` | For every test session, DB status matches sidebar status |

### 7. Sidebar Interaction

**File**: `tests/suites/sidebar-interaction.test.ts`
**What it verifies**: Session selection UI state and sidebar width control.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | selects a session | `sidebar_select_session`, `sidebar_get_selected` | Selected session ID matches the one we set |
| 2 | deselects with null | `sidebar_select_session`, `sidebar_get_selected` | Selected session ID becomes null |
| 3 | switches selection between sessions | `sidebar_select_session`, `sidebar_get_selected` | Selection changes correctly when switching between two sessions |
| 4 | gets sidebar width | `layout_get_sidebar_width` | Width is between 200–500px (valid range) |
| 5 | sets sidebar width and reads it back | `layout_set_sidebar_width`, `layout_get_sidebar_width` | Set to 350px, read back 350px, then restore original |

### 8. Sidebar Tabs

**File**: `tests/suites/sidebar-tabs.test.ts`
**What it verifies**: Sidebar tab switching and active tab query.

**Setup/teardown**: Saves original active tab in `beforeAll`, restores in `afterAll`.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | get_active_tab returns current tab | `sidebar_get_active_tab` | Returns one of `sessions`, `commits`, `tokens`, `activity` |
| 2 | switch_tab switches to each tab | `sidebar_switch_tab`, `sidebar_get_active_tab` | Switch to each tab and verify via get_active_tab |
| 3 | switch_tab returns confirmation text | `sidebar_switch_tab` | Response contains "Sidebar switched to" and tab name |
| 4 | switch_tab round-trips correctly | `sidebar_switch_tab`, `sidebar_get_active_tab` | Switch → get → verify match for multiple tabs |

### 9. Detach Semantics

**File**: `tests/suites/detach-semantics.test.ts`
**What it verifies**: Closing a tile (detach) does NOT kill the session — a key UX distinction.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | removing tile does not kill the session | `layout_add_tile`, `layout_remove_tile`, `session_get_status` | Session remains `active` after its tile is removed |
| 2 | can re-add tile after detach | `layout_add_tile`, `layout_get_tile_count` | Tile count increases when re-adding a detached session |
| 3 | can kill a detached session | `layout_remove_tile`, `session_kill`, `session_wait_for_status`, `session_get_status` | A session with no tile can still be killed and transitions to `ended` |

### 10. Terminal I/O

**File**: `tests/suites/terminal-io.test.ts`
**What it verifies**: Basic terminal input/output — send commands, read buffer, check dimensions.

**Setup**: Creates a session and adds a tile (required for xterm.js to render the buffer).

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | sends keys and reads output | `terminal_send_keys`, `terminal_wait_for_content` | `echo hello-mcode-test` output appears in buffer |
| 2 | reads buffer with line limit | `terminal_read_buffer` | With `lines: 5`, returned text has at most 5 lines |
| 3 | gets terminal dimensions | `terminal_get_dimensions` | cols > 0, rows > 0 |

### 11. Terminal Advanced

**File**: `tests/suites/terminal-advanced.test.ts`
**What it verifies**: PTY resize, signal handling, timeout behavior, sequential command isolation.

**Setup**: Creates a session with a tile for xterm.js rendering.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | resizes terminal and verifies new dimensions | `terminal_resize`, `session_info` | Resize to 120x40 → both the resize response and `session_info` reflect new dimensions |
| 2 | sends Ctrl+C to interrupt a running command | `terminal_send_keys`, `terminal_wait_for_content` | `sleep 60` is interrupted by `\x03`; shell prompt (`$`) reappears |
| 3 | wait_for_content times out on non-matching pattern | `terminal_wait_for_content` | Returns `isError: true` with "Timeout" message after 1s |
| 4 | handles multiple sequential commands | `terminal_send_keys`, `terminal_wait_for_content` | Two sequential echo commands both appear in buffer; output is not mixed |

### 12. Terminal Actions

**File**: `tests/suites/terminal-actions.test.ts`
**What it verifies**: Terminal execute actions (selectAll, copy, clear) and file drop simulation.

**Setup**: Creates a session with a tile for xterm.js rendering.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | clear removes scrollback | `terminal_send_keys`, `terminal_wait_for_content`, `terminal_execute_action`, `terminal_read_buffer` | Buffer no longer contains marker after clear |
| 2 | selectAll + copy returns buffer content | `terminal_send_keys`, `terminal_wait_for_content`, `terminal_execute_action` | Copy after selectAll contains echoed marker |
| 3 | drop_files writes path to terminal | `terminal_drop_files`, `terminal_read_buffer` | Dropped `package.json` path appears in buffer |

### 13. Window Tools

**File**: `tests/suites/window-tools.test.ts`
**What it verifies**: Electron window management — screenshot capture, bounds query, resize.

**Setup/teardown**: Saves original window bounds in `beforeAll`, restores them in `afterAll`.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | takes a screenshot | `window_screenshot` | Returns base64 PNG image content (gracefully skips in headless environments) |
| 2 | gets window bounds | `window_get_bounds` | Returns x, y (numbers), width > 0, height > 0 |
| 3 | resizes window and verifies | `window_resize`, `window_get_bounds` | Resize to 1200x800 (above macOS minimum), bounds match afterward |

### 14. App Introspection

**File**: `tests/suites/app-introspection.test.ts`
**What it verifies**: App metadata and renderer-side capture mechanisms.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | returns app version as non-empty string | `app_get_version` | Non-empty, matches semver pattern `X.Y.Z` |
| 2 | returns console logs as array | `app_get_console_logs` | Response is a valid array |
| 3 | filters console logs by level | `app_get_console_logs` | With `level: "error"`, every returned entry has `level === "error"` |
| 4 | respects console log limit | `app_get_console_logs` | With `limit: 3`, at most 3 entries returned |
| 5 | returns HMR events as array | `app_get_hmr_events` | Response is a valid array |

### 15. App Sleep Prevention

**File**: `tests/suites/app-sleep.test.ts`
**What it verifies**: Sleep prevention controls — enable, disable, status query, idempotent toggling.

**Setup/teardown**: Saves original enabled state in `beforeAll`, restores in `afterAll`.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | get_sleep_blocker_status returns valid shape | `app_get_sleep_blocker_status` | Has `enabled` (boolean) and `blocking` (boolean) |
| 2 | set_prevent_sleep enables sleep prevention | `app_set_prevent_sleep`, `app_get_sleep_blocker_status` | enabled → true |
| 3 | set_prevent_sleep disables sleep prevention | `app_set_prevent_sleep`, `app_get_sleep_blocker_status` | enabled → false |
| 4 | toggling is idempotent | `app_set_prevent_sleep` | Set true twice, no error, still enabled |

### 16. App Startup

**File**: `tests/suites/app-startup.test.ts`
**What it verifies**: Renderer bridge responds after app startup.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | responds to renderer bridge queries after startup | `app_get_console_logs` | Returns valid array, every entry has `args` array |

### 17. Error Cases

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

### 18. Concurrent Sessions

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

### 19. Permission Modes

**File**: `tests/suites/permission-modes.test.ts`
**What it verifies**: Our `PERMISSION_MODES` constant stays in sync with the Claude CLI's accepted `--permission-mode` values.

**Note**: This suite does not use MCP tools — it runs `claude --permission-mode __invalid__` and parses the CLI error to extract valid modes.

| # | Test | What it checks |
|---|------|----------------|
| 1 | PERMISSION_MODES matches Claude CLI allowed choices | Parses "Allowed choices are ..." from CLI error; verifies our constant has no missing or extra modes |

### 20. Hook Config

**File**: `tests/suites/hook-config.test.ts`
**What it verifies**: Pure unit tests for hook config merging, port-scoped cleanup, and PID extraction (no MCP server needed).

| # | Test | What it checks |
|---|------|----------------|
| 1 | merges mcode hooks using Claude hook groups | Existing user hooks preserved; mcode hooks appended with correct URL, headers, and `allowedHttpHookUrls` |
| 2 | removes matching-port mcode-owned hooks and preserves user hooks | Port-scoped cleanup removes matching hooks with `X-Mcode-Hook`; user hooks untouched; empty groups pruned |
| 3 | includes PID header in hook entries | Merged hooks include `X-Mcode-PID` header matching `process.pid` |
| 4 | mergeMcodeHooks preserves other instances' hooks | Two merges on different ports both survive; PreToolUse has entries for both ports |
| 5 | mergeMcodeHooks replaces its own port on re-merge | Re-merging same port does not duplicate; PreToolUse has exactly one entry |
| 6 | removeMcodeHooksForPort only removes hooks for specified port | Port 7777 removed, port 7778 preserved |
| 7 | removeMcodeHooksForPort preserves user hooks | User hooks without `X-Mcode-Hook` header survive port-scoped removal |
| 8 | extractMcodeHookPortPids finds port+PID pairs from settings | Two merged ports → map size 2, both keyed by port, values are process PIDs |
| 9 | extractMcodeHookPortPids returns empty map for no hooks | Empty settings → empty map |

### 21. Hook Integration

**File**: `tests/suites/hook-integration.test.ts`
**What it verifies**: Hook event processing lifecycle — event injection, status transitions, attention levels, event persistence, and HTTP error responses.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | hook runtime is ready or degraded, never initializing | `app_get_hook_runtime` | State is `ready` or `degraded`, not `initializing` |
| 2 | SessionStart transitions to active | `hook_inject_event`, `session_create`, `session_wait_for_status` | Status becomes `active`, claudeSessionId is set |
| 3 | PreToolUse updates lastTool | `hook_inject_event` | `lastTool` reflects the tool name |
| 4 | PostToolUse stays active | `hook_inject_event` | Status remains `active` |
| 5 | Stop transitions to idle with action attention | `hook_inject_event` | Status `idle`, attention `action` |
| 6 | PermissionRequest transitions to waiting with action attention | `hook_inject_event` | Status `waiting`, attention `action`, reason contains tool name |
| 7 | PostToolUse returns to active and clears action attention | `hook_inject_event` | Status `active`, attention `none` |
| 8 | SessionEnd with PTY alive clears attention but keeps status (no claudeSessionId) | `hook_inject_event`, `session_create`, `session_wait_for_status` | Attention clears while the live PTY session keeps its current status |
| 9 | SessionEnd with PTY alive clears attention for resumable sessions (has claudeSessionId) | `hook_inject_event`, `session_create`, `session_wait_for_status` | Attention clears and `attentionReason` becomes null while status remains resumable |
| 10 | SessionEnd with PTY alive keeps current status (supports /resume) | `hook_inject_event`, `session_create`, `session_wait_for_status` | Live sessions stay non-`ended` so `/resume` can reuse them |
| 11 | /resume flow: SessionEnd + SessionStart with new claudeSessionId | `hook_inject_event`, `session_create`, `session_wait_for_status` | Session stays active across a resume handoff and updates to the new Claude session ID |
| 12 | events are persisted and retrievable with sessionStatus | `hook_list_recent` | Events list is non-empty, contains correct sessionId and sessionStatus |
| 13 | POST garbage to hook server returns 400 | direct HTTP fetch | 400 status on malformed JSON (skipped if runtime not ready) |
| 14 | valid JSON but unknown event name returns 400 | direct HTTP fetch | 400 for `MadeUpEvent` |
| 15 | valid event but unknown session returns 200 (silently accepted) | direct HTTP fetch | 200 for nonexistent session header |
| 16 | Stop when already idle does not change attention | `hook_inject_event`, `session_clear_attention`, `session_get_status` | Second Stop on idle session with cleared attention keeps attention `none` |
| 17 | PTY exit transitions to ended and clears attention | `session_kill`, `session_wait_for_status` | Status `ended`, attention `none` after kill |
| 18 | sessionStatus reflects correct state after each event | `hook_inject_event`, `hook_list_recent` | Each event's sessionStatus matches expected state (active/idle/waiting) |
| 19 | polling does not override hook-driven waiting status | `hook_inject_event`, `terminal_send_keys`, `session_get_status` | Status remains `waiting` after poll cycle |
| 20 | Stop after ExitPlanMode transitions to waiting | `hook_inject_event` | Status `waiting`, attention `action`, reason "Waiting for your response" |
| 21 | Stop after AskUserQuestion transitions to waiting | `hook_inject_event` | Status `waiting`, attention `action`, reason "Waiting for your response" |
| 22 | PreToolUse after user-choice waiting transitions back to active | `hook_inject_event` | Status `active`, attention `none` after resuming |
| 23 | Stop after normal tool still transitions to idle | `hook_inject_event` | Status `idle`, attention `action`, reason "Claude finished — awaiting next input" |
| 24 | hook_list_recent_all returns events with sessionStatus across sessions | `hook_list_recent_all` | Non-empty array with sessionStatus field |
| 25 | hook_clear_all_events removes all events | `hook_clear_all_events`, `hook_list_recent_all` | Events list empty after clearing |

### 22. Attention System

**File**: `tests/suites/attention-system.test.ts`
**What it verifies**: Attention level assignment, priority ordering, clearing, and sidebar sorting by attention.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | PermissionRequest sets action attention | `hook_inject_event` | attention `action`, status `waiting` |
| 2 | attention summary reports one action session | `app_get_attention_summary` | `action >= 1`, dockBadge truthy |
| 3 | Notification sets info attention on another session | `hook_inject_event` | attention `info`, status `active` |
| 4 | Stop sets action attention on a third session (no pending tasks) | `hook_inject_event` | attention `action`, status `idle` |
| 5 | clear_attention clears one session without changing status | `session_clear_attention` | attention `none`, status unchanged |
| 6 | clear_all_attention clears all sessions | `session_clear_all_attention`, `app_get_attention_summary` | all counts zero |
| 7 | action attention is not overridden by info events | `hook_inject_event` | attention stays `action` after Notification |
| 8 | PostToolUseFailure does not change attention | `hook_inject_event` | attention `none` (Claude handles tool failures autonomously) |
| 9 | user selection clears attention for that session only | `sidebar_select_session`, `session_get_status` | selected session cleared, other unchanged |
| 10 | killing a session with active attention clears it | `session_kill`, `session_wait_for_status`, `session_get_status`, `hook_inject_event` | Ended session has attention `none` |
| 11 | SessionEnd always clears attention, even for resumable sessions | `hook_inject_event`, `session_get_status` | SessionEnd with claudeSessionId still clears attention |
| 12 | sidebar sorts sessions: action first, then info, then none | `sidebar_get_sessions` | action index < info index < none index |

### 23. Task Queue

**File**: `tests/suites/task-queue.test.ts`
**What it verifies**: Task CRUD, update, reorder, dispatch to sessions, failure handling, scheduled tasks, and validation.

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
| 12 | rejects task targeting fallback-mode Claude session | `task_create`, `session_create` | Throws `/live hook mode/i` |
| 13 | task_update changes prompt of pending task | `task_update`, `task_create`, `task_list`, `task_cancel` | Updated prompt persists in task list |
| 14 | task_update changes priority and scheduledAt | `task_update`, `task_create`, `task_cancel` | Both fields updated correctly |
| 15 | task_update rejects non-pending tasks | `task_update`, `task_create`, `task_cancel` | Throws `/only pending/i` for dispatched task |
| 16 | assigns sort_order on session-targeted task creation | `task_create`, `task_cancel` | 3 tasks get sortOrder 1, 2, 3 |
| 17 | standalone tasks have null sort_order | `task_create`, `task_cancel` | sortOrder is null for tasks without targetSessionId |
| 18 | reorders tasks up within session | `task_reorder`, `task_create`, `task_list`, `task_cancel` | Move t3 up → order [t1, t3, t2] |
| 19 | reorders tasks down within session | `task_reorder`, `task_create`, `task_list`, `task_cancel` | Move t1 down → order [t2, t1] |
| 20 | reorder at boundary throws error | `task_reorder`, `task_create`, `task_cancel` | Up at top → `/already at the top/i`; down at bottom → `/already at the bottom/i` |
| 21 | reorder rejects non-pending and standalone tasks | `task_reorder`, `task_create`, `task_cancel` | Standalone → `/standalone/i`; dispatched → `/only pending/i` |

### 24. Commit Tracking

**File**: `tests/suites/commit-tracking.test.ts`
**What it verifies**: Commit statistics, heatmap, streaks, cadence, weekly trend, and scan mode controls.

**Setup**: Calls `commits_refresh` to ensure tracker has data. **Teardown**: Restores original scan mode.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | commits_refresh completes | `commits_refresh` | Response contains "Scan complete" |
| 2 | commits_force_rescan completes and returns stats | `commits_force_rescan` | Response contains "Force rescan complete" |
| 3 | get_daily_stats returns valid shape | `commits_get_daily_stats` | Has `total`, `claude`, `solo` (numbers >= 0), `repos` (array) |
| 4 | get_daily_stats accepts date parameter | `commits_get_daily_stats` | Far past date (2020-01-01) → total 0 |
| 5 | get_heatmap returns array of entries | `commits_get_heatmap` | Default 7 entries, each has `date` and `count` |
| 6 | get_heatmap respects days parameter | `commits_get_heatmap` | days: 3 → 3 entries |
| 7 | get_streaks returns streak info | `commits_get_streaks` | Has `current`, `longest` (numbers >= 0) |
| 8 | get_cadence returns cadence info | `commits_get_cadence` | Has `averageMinutesBetween`, `peakHour`, `distribution` |
| 9 | get_weekly_trend returns trend info | `commits_get_weekly_trend` | Has `thisWeek`, `lastWeek`, `percentChange` |
| 10 | get_scan_mode returns current mode | `commits_get_scan_mode` | Has `scanAllBranches` boolean |
| 11 | set_scan_mode round-trips correctly | `commits_set_scan_mode`, `commits_get_scan_mode` | Toggle, verify change, restore original |

### 25. File Tools

**File**: `tests/suites/file-tools.test.ts`
**What it verifies**: File listing, reading (text and binary detection), writing with round-trip verification, file viewer, and quick open toggle.

**Teardown**: Deletes temp files created during tests via `fs.unlink`.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | file_list returns files for git repo | `file_list` | `isGitRepo` is `true`, `count > 0`, `files` is array capped at 100 entries |
| 2 | file_read returns content and language for known file | `file_read` | Reading `package.json` returns `language: "json"`, `lines > 0`, content contains `"name"` |
| 3 | file_read returns binary message for non-text file | `file_read` | Reading `resources/icon.icns` returns "Binary file" text |
| 4 | file_write creates file and file_read reads it back | `file_write`, `file_read` | Round-trip: write temp file, read back, content matches |
| 5 | file_write returns character count | `file_write` | Response contains "Written" and correct character count |
| 6 | file_open_viewer returns success | `file_open_viewer` | Response contains "Opened file viewer" |
| 7 | quick_open_toggle returns mode confirmation | `quick_open_toggle` | Toggle with `mode: "files"` and `mode: "commands"` return correct mode text |

### 26. Token Usage

**File**: `tests/suites/token-usage.test.ts`
**What it verifies**: Token usage tracking — refresh scan, daily/session/model breakdown, weekly trends, and heatmap.

**Setup**: Calls `tokens_refresh` in `beforeAll` to ensure scanner has data.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | tokens_refresh completes and returns summary | `tokens_refresh` | Response contains "Scan complete" |
| 2 | get_daily_usage returns valid shape | `tokens_get_daily_usage` | Has `date`, `totals` (with token counts), `estimatedCostUsd`, `messageCount`, `byModel`, `topSessions` |
| 3 | get_daily_usage accepts date parameter | `tokens_get_daily_usage` | Far past date (2020-01-01) → `messageCount === 0`, `estimatedCostUsd === 0` |
| 4 | get_session_usage returns valid shape | `tokens_get_session_usage` | Has `claudeSessionId`, `models`, `totals`, `estimatedCostUsd`, `messageCount` |
| 5 | get_session_usage returns zeros for unknown session | `tokens_get_session_usage` | Fake UUID → `messageCount === 0` |
| 6 | get_model_breakdown returns array | `tokens_get_model_breakdown` | Array; each entry has `model`, `modelFamily`, `totals`, `estimatedCostUsd`, `pctOfTotalCost` |
| 7 | get_model_breakdown respects days parameter | `tokens_get_model_breakdown` | `days: 1` and `days: 30` both return valid arrays |
| 8 | get_weekly_trend returns trend shape | `tokens_get_weekly_trend` | Has `thisWeek` and `lastWeek` sub-objects with `outputTokens`, `estimatedCostUsd`, `messageCount` |
| 9 | get_heatmap returns array with correct length | `tokens_get_heatmap` | Default → 7 entries; `days: 3` → 3 entries; each has `date`, `outputTokens`, `estimatedCostUsd`, `messageCount` |

### 27. Git Tools

**File**: `tests/suites/git-tools.test.ts`
**What it verifies**: Git status queries, diff content retrieval, and diff viewer opening.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | git_get_status returns valid shape for repo cwd | `git_get_status` | Returns object with `repoRoot`, `staged` array, and `unstaged` array; each entry has `path` and `status` |
| 2 | git_get_status returns empty arrays for non-git path | `git_get_status` | Non-git cwd returns empty `staged` and `unstaged` arrays (graceful, not error) |
| 3 | git_get_all_statuses returns array | `git_get_all_statuses` | Returns array (possibly empty) |
| 4 | git_get_diff_content returns diff shape for known file | `git_get_diff_content` | Returns object with `originalContent`, `modifiedContent`, and `language`, or "Binary file" text |
| 5 | git_get_diff_content returns empty content for non-existent file | `git_get_diff_content` | Returns `originalContent` and `modifiedContent` as empty strings (graceful, not error) |
| 6 | git_open_diff_viewer returns success | `git_open_diff_viewer` | Response contains "Opened diff viewer" |

### 28. Snippet Tools

**File**: `tests/suites/snippet-tools.test.ts`
**What it verifies**: Snippet scanning — frontmatter parsing, variable extraction (explicit and auto-detected), and empty directory handling.

**Setup**: Creates temp directory with 3 snippet `.md` files (full frontmatter with variables, no variables, no frontmatter with body placeholders). **Teardown**: Removes temp directory.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | snippet_list returns parsed entries for project snippets | `snippet_list` | Returns array with 3 project-level entries |
| 2 | parses frontmatter with variables correctly | `snippet_list` | "Review PR" has correct name, description, 2 variables (with defaults), body contains placeholders |
| 3 | parses snippet with no variables | `snippet_list` | "Quick Fix" has empty variables array, body present |
| 4 | auto-extracts variables from body when no frontmatter variables | `snippet_list` | "deploy" has 2 auto-extracted variables (`service`, `environment`) |
| 5 | returns empty array for directory with no snippets | `snippet_list` | No error for directory without `.mcode/snippets/`; returns valid array |

### 29. Session Account Assignment

**File**: `tests/suites/session-account.test.ts`
**What it verifies**: Session creation with and without accountId — verifies persistence to DB.

**Setup**: Fetches default account via `account_list` in `beforeAll`.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | creates session without accountId → null | `session_create`, `session_get_status` | accountId is null in both create response and DB |
| 2 | creates session with accountId → stored | `session_create`, `session_get_status`, `account_list` | accountId matches default account |

### 30. Session Label Source

**File**: `tests/suites/session-label-source.test.ts`
**What it verifies**: User-provided labels are not overwritten by later auto-label updates, while unlabeled sessions can still accept an auto-generated title.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | preserves user-provided label when setAutoLabel is called | `session_create`, `session_set_auto_label` | Explicit labels survive later auto-label attempts |
| 2 | allows auto-label to update when no user label was provided | `session_create`, `session_set_auto_label` | Directory-derived default label can be replaced by auto-label |

### 31. Session Model

**File**: `tests/suites/session-model.test.ts`
**What it verifies**: Session model metadata starts null, can be updated, persists through status/list reads, and errors cleanly for unknown sessions.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | new session has null model | `session_create` | Fresh sessions do not report a model by default |
| 2 | session_set_model updates model | `session_set_model` | Model field updates to the requested value |
| 3 | model persists through session_get_status | `session_get_status` | Re-read status returns the persisted model |
| 4 | model appears in session_list | `session_list` | Session list includes the stored model |
| 5 | model can be updated (simulates /model switch) | `session_set_model`, `session_get_status` | Later model changes persist correctly |
| 6 | terminal session has null model | `session_create` | Terminal sessions do not report a model |
| 7 | session_set_model returns error for unknown session | `session_set_model` | Unknown session IDs return `isError: true` |

### 32. Stress Sessions

**File**: `tests/suites/stress-sessions.test.ts`
**What it verifies**: The app handles 10 simultaneous sessions — creation, state tracking, independent I/O, and teardown.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | creates 10 sessions concurrently | `session_create` | All 10 created via `Promise.all` |
| 2 | all sessions transition to active | `session_wait_for_status` | All 10 reach `active` concurrently |
| 3 | all sessions appear in session_list | `session_list` | All 10 IDs present |
| 4 | each session has independent terminal I/O | `terminal_send_keys`, `terminal_wait_for_content` | Unique marker in each session's buffer |
| 5 | kills all sessions and all transition to ended | `session_kill`, `session_wait_for_status`, `session_get_status` | All 10 reach `ended` |
| 6 | tile count returns to baseline after kills | `layout_wait_for_tile_count`, `layout_get_tile_count` | Returns to pre-test count |

### 33. Task Concurrent Dispatch

**File**: `tests/suites/task-concurrent-dispatch.test.ts`
**What it verifies**: Parallel task dispatch to multiple sessions, priority ordering, and graceful failure.

**Setup**: Creates 2 live Claude sessions and waits for both to be idle.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | dispatches tasks to different sessions in parallel | `task_create`, `task_wait_for_status` | Both dispatched to different sessions concurrently |
| 2 | respects priority ordering for same-session tasks | `task_create`, `task_list`, `task_cancel` | Higher priority task listed first |
| 3 | tasks targeting non-existent session fail gracefully | `task_create` | Throws `/not found/i` |

### 34. File Search

**File**: `tests/suites/file-search.test.ts`
**What it verifies**: File search tool — query matching, regex mode, case-sensitivity, and maxResults cap.

**Setup**: Creates a session for search context.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | file_search finds known string in codebase | `file_search` | `totalMatches > 0`, result contains expected file |
| 2 | file_search returns empty for nonexistent string | `file_search` | `totalMatches === 0`, "No matches found." |
| 3 | file_search supports regex mode | `file_search` | Regex pattern `class\\s+FileSearch` matches |
| 4 | file_search supports case-sensitive mode | `file_search` | `caseSensitive: true` flag is respected |
| 5 | file_search respects maxResults cap | `file_search` | Results capped at 3 |

### 35. Session Detach and Restore

**File**: `tests/suites/session-detach-restore.test.ts`
**What it verifies**: The detach/reconcile cycle — simulates app close and reopen, verifying session states and attention levels are preserved.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | creates sessions in different states for detach testing | `session_create`, `hook_inject_event` | idle, active, and waiting states created |
| 2 | detachAllActive preserves all session states | `app_detach_all`, `session_get_status` | All sessions become `detached` |
| 3 | reconcileDetachedSessions restores pre-detach states | `app_reconcile_detached`, `session_get_status` | idle→idle, active→active, waiting→waiting |
| 4 | reconcileDetachedSessions marks dead sessions as ended | `app_detach_all`, `app_reconcile_detached`, `session_get_status` | Sessions not in aliveSessionIds become ended |
| 5 | preserves attention levels through detach+restore cycle | `app_detach_all`, `app_reconcile_detached`, `session_get_status`, `hook_inject_event` | action attention preserved through cycle |

### 36. Sidebar Session Filter

**File**: `tests/suites/sidebar-session-filter.test.ts`
**What it verifies**: Sidebar search filter — set, get, clear, and verify it's UI-only (doesn't affect `sidebar_get_sessions`).

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | set and get filter query | `sidebar_set_session_filter`, `sidebar_get_session_filter` | Query round-trips correctly |
| 2 | clear filter with empty string | `sidebar_set_session_filter`, `sidebar_get_session_filter` | Empty string clears filter |
| 3 | filter does not affect sidebar_get_sessions (UI-only) | `sidebar_set_session_filter`, `sidebar_get_session_filter`, `sidebar_get_sessions` | All sessions returned regardless of filter |

### 37. Page Scroll Prevention

**File**: `tests/suites/layout-no-page-scroll.test.ts`
**What it verifies**: The app root element never overflows the viewport — regression test for the scroll-with-empty-space bug (165b6be).

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | document scrollHeight does not exceed clientHeight | `window_execute_js` | `document.documentElement.scrollHeight ≤ clientHeight` |

### 38. Auto Mode Flag

**File**: `tests/suites/auto-mode.test.ts`
**What it verifies**: The `enableAutoMode` flag is persisted for Claude sessions and ignored for terminal sessions.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | session created with enableAutoMode=true stores and returns it | `session_create`, `session_get_status` | `enableAutoMode` is `true` in both create response and status re-read |
| 2 | session created without enableAutoMode has it undefined | `session_create`, `session_get_status` | `enableAutoMode` absent from response |
| 3 | terminal session with enableAutoMode=true ignores it | `session_create` | `enableAutoMode` always undefined for `sessionType: 'terminal'` |

### 39. Codex Support

**File**: `tests/suites/codex-support.test.ts`
**What it verifies**: Codex sessions can be created through MCP, ignore Claude-only session flags, and appear correctly in sidebar and kanban views.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | creates a Codex session via MCP | `session_create` | Session is marked `sessionType: "codex"` and omits Claude-only fields |
| 2 | omits Claude-only fields for Codex sessions even if they are provided | `session_create`, `session_get_status` | Permission, effort, auto mode, bypass, and worktree fields are ignored |
| 3 | shows Codex sessions in the sidebar and kanban as agent sessions | `sidebar_get_sessions`, `kanban_get_columns`, `layout_set_view_mode` | Session appears in sidebar and lands in a valid kanban agent column |

### 40. Codex Resume

**File**: `tests/suites/codex-resume.test.ts`
**What it verifies**: Codex sessions can only be resumed when a thread ID has been recorded, and resume reuses the existing session ID in place.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | returns an error when no Codex thread ID is recorded | `session_resume` | Resume fails with a clear error when the session has no recorded Codex thread ID |
| 2 | resumes a Codex session in place with the same session ID | `session_set_codex_thread_id`, `session_resume`, `sidebar_get_sessions`, `terminal_read_buffer` | Resume keeps the original session ID, restores live state, and preserves sidebar identity |

### 41. Terminal Panel Resize

**File**: `tests/suites/terminal-panel-resize.test.ts`
**What it verifies**: The xterm.js container resizes proportionally when the terminal panel height changes.

| # | Test | MCP tools | What it checks |
|---|------|-----------|----------------|
| 1 | xterm container resizes when panel height changes | `terminal_panel_set_height`, `terminal_panel_get_dimensions` | `xtermHeight` grows with panel; growth delta ≤20px of panel growth (row-rounding tolerance) |

---

## Coverage Summary

Current inventory: **41 suites** and **248 `it(...)` / `it.skipIf(...)` test cases** under `tests/suites`.

| Feature Area | Representative suites | Key behaviors verified |
|-------------|-----------------------|------------------------|
| Session lifecycle and metadata | 1, 2, 17, 18, 29, 30, 31 | Create, status transitions, list, label, PTY info, kill/delete flows, error handling, account assignment, label source rules, model persistence |
| Layout and navigation | 3, 4, 5, 6, 7, 8, 9, 36, 37, 41 | Tile lifecycle, kanban grouping, sidebar state, tab/filter behavior, page scroll regression coverage, terminal panel resize |
| Terminal and window tools | 10, 11, 12, 13 | Terminal I/O, resize, signals, clipboard actions, file drop, screenshots, window bounds and resize |
| App and hook runtime | 14, 15, 16, 19, 20, 21, 22 | App metadata, sleep prevention, startup bridge, permission mode checks, hook config, hook lifecycle integration, attention behavior |
| Tasking and analytics | 23, 24, 26, 33 | Task CRUD/reordering/dispatch, commit tracking, token usage, concurrent task dispatch |
| File, git, and snippets | 25, 27, 28, 34 | File list/read/write, git status and diff access, snippet parsing, file search |
| Session persistence and agent-specific flows | 35, 38, 39, 40 | Detach/reconcile cycle, auto mode persistence, Codex session creation, Codex resume semantics |

## Writing New Tests

1. Add a new file in `tests/suites/` with the `.test.ts` extension.
2. Use `McpTestClient` from `../mcp-client` and helpers from `../helpers`.
3. For integration suites that mutate shared state, call `resetTestState(client)` in `beforeAll` before creating sessions or toggling global UI state.
4. Always connect in `beforeAll` and disconnect in `afterAll`.
5. Clean up sessions in `afterAll` or `afterEach` using `cleanupSessions()`.
6. Prefer the helpers in `tests/helpers.ts` over raw tool calls when a helper already captures the expected polling or cleanup pattern.
7. If your test needs terminal buffer reads, add a tile first (`layout_add_tile`) — xterm.js only renders the buffer when a tile is mounted.
8. For tools with all-optional params, pass `{}` (not omit args) to satisfy MCP SDK validation.
