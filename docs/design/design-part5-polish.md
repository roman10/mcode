# mcode — Part 5: Polish & Ship

> **Phases covered:** 8 (Polish & Ship)
> **Prerequisites:** Part 4 complete (task queue working)
> **Outcome:** Keyboard shortcuts, session resume, settings, activity feed, macOS packaging — ready for daily use
> **Reference:** See `design-v1.md` for full architecture

---

## Scope Adjustments

This document supersedes a few earlier assumptions so the phase matches the current codebase and can be implemented directly.

- **Resume is in-place, not a new internal session.** The existing implementation reuses the same `session_id`, resets the row to `starting`, and spawns a new PTY attached to that same session record.
- **`Cmd+T` means new terminal session, not new task.** This already matches the renderer behavior and is the better default for a terminal-first app.
- **`Cmd+K` is not a command palette in this phase.** It is already used inside terminals for clear-screen behavior; a global quick switcher is deferred.
- **Ring buffer implementation stays simple.** The current capped string buffer in the main process is sufficient; no circular `Uint8Array` rewrite is needed in this phase.
- **Persisted terminal font settings are deferred.** Terminals already support per-instance zoom shortcuts; global font preferences are not part of the remaining Phase 8 work.

---

## Architecture Context

### Keyboard Shortcuts

Final Phase 8 shortcut set:

| Shortcut | Action | Registration | Notes |
|---|---|---|---|
| `Cmd+N` | New Claude session dialog | App menu accelerator | Existing renderer shortcut stays functionally identical; final implementation should move this to the menu so xterm cannot swallow it |
| `Cmd+T` | New terminal session | App menu accelerator | Replaces the stale "new task" assumption |
| `Cmd+1..9` | Focus session by index | App menu accelerator | Index is based on the current visible sidebar session order, excluding external history and ephemeral sessions |
| `Cmd+]` / `Cmd+[` | Focus next/previous session | App menu accelerator | Uses the same ordering source as `Cmd+1..9`; accelerator entries also suppress browser back/forward |
| `Cmd+\` | Toggle sidebar collapsed state | App menu accelerator | Requires persisted `sidebarCollapsed` state in layout storage |
| `Cmd+W` | Close current tile | Tile `onKeyDown` | PTY keeps running |
| `Cmd+Shift+W` | Kill current session | Tile `onKeyDown` | Existing behavior remains |
| `Cmd+D` | Split current tile right | Tile `onKeyDown` | Opens New Session dialog in split-right mode; no placeholder tile is created until the dialog completes |
| `Cmd+Shift+D` | Split current tile down | Tile `onKeyDown` | Same as above, split-down mode |
| `Cmd+Enter` | Maximize / restore current tile | Tile `onKeyDown` | Uses transient restore state in the renderer store |
| `Cmd+K` | Clear current terminal | Terminal key handler | Not repurposed in this phase |

Registration strategy:

- Do **not** use Electron `globalShortcut`.
- App-level shortcuts are registered in the Electron app menu and dispatch semantic commands to the renderer via the `app:command` IPC channel.
- Tile-scoped shortcuts stay in `TerminalTile` so the handler always knows the active tile.
- `TerminalInstance.attachCustomKeyEventHandler()` already blocks `Cmd+N`, `Cmd+T`, `Cmd+W` from the PTY. Phase 8 must **add** blocks for `Cmd+D`, `Cmd+Shift+D`, `Cmd+Enter`, `Cmd+]`, `Cmd+[`, and `Cmd+\` so these new shortcuts bubble up to the tile or menu instead of reaching the PTY.
- The current document-level shortcut handler in the sidebar is transitional. Phase 8 should remove it once the menu-driven command path exists, to avoid duplicate handling.

App-command dispatch mechanism:

```typescript
// Command type (shared/types.ts)
type AppCommand =
  | { command: 'new-session' }
  | { command: 'new-terminal' }
  | { command: 'focus-session-index'; index: number }
  | { command: 'focus-next-session' }
  | { command: 'focus-prev-session' }
  | { command: 'toggle-sidebar' };

// Main process: menu click handler sends to renderer
webContents.send('app:command', command);

// Preload bridge (add to MCodeAPI.app)
onCommand(cb: (command: AppCommand) => void): () => void;

// Renderer: App.tsx subscribes on mount and dispatches
// to layout-store / session-store as appropriate.
```

For `focus-session-index`, each `Cmd+1..9` menu item sends `{ command: 'focus-session-index', index: N }` where N is 0-based. If the index exceeds the visible session count, the command is a no-op.

Session-ordering source for focus shortcuts:

- Reuse the same ordering the sidebar shows today: attention priority, then status priority, then `startedAt` descending.
- Extract that ordering logic into a shared renderer helper so both `SessionList` and shortcut handlers use the exact same session order.
- If a shortcut targets a session that has no tile open, add its tile first, then select it.

Sidebar toggle behavior:

- Add `sidebarCollapsed: boolean` to the persisted layout snapshot. This means updating:
  - `LayoutStateSnapshot` type in `shared/types.ts` (add `sidebarCollapsed: boolean`)
  - `layout:save` IPC handler and preload bridge to accept the new field
  - `SessionManager.saveLayout()` / `loadLayout()` and the `layout_state` SQLite table (`ALTER TABLE layout_state ADD COLUMN sidebar_collapsed INTEGER DEFAULT 0`)
  - `useLayoutStore` state, `persist()`, and `restore()` methods
- Keep `sidebarWidth` unchanged while collapsed so restoring the sidebar returns to the previous width.
- When collapsed, the resize handle is hidden and the mosaic uses the full window width.

Split / maximize behavior:

- `Cmd+D` and `Cmd+Shift+D` set a pending split intent `{ anchorSessionId, direction }` and open the existing New Session dialog.
- If the dialog is cancelled, layout is unchanged.
- If the dialog completes, create the session first, then insert the new tile adjacent to the anchor tile using a new layout-store helper such as `addTileAdjacent(anchorSessionId, newSessionId, direction)`.
- `Cmd+Enter` maximizes the current tile by storing a transient `restoreTree` in renderer state and replacing `mosaicTree` with the active leaf.
- Restore reverses that operation after pruning dead session leaves.
- Maximized state is transient only. If the app is closed while maximized, the persisted layout is the maximized layout.

### Session Resume

Canonical behavior for Phase 8 is the existing implementation: resume **in place**.

When an ended Claude session has a `claude_session_id`:

- Show a **Resume Session** button in the ended-session prompt.
- Clicking it reuses the same internal `session_id`.
- Reset the existing session row to `starting`, clear `ended_at`, and keep the existing tile/sidebar card in place.
- Spawn `claude --resume <claude_session_id>` with `MCODE_SESSION_ID` set to the same internal `session_id`.
- When the resumed PTY emits output or hooks arrive, the same session transitions back to `active`.

```typescript
// Resume-in-place flow
db.prepare(
  `UPDATE sessions
   SET status = 'starting', ended_at = NULL, hook_mode = ?
   WHERE session_id = ?`,
).run(hookMode, sessionId);

ptyManager.spawn({
  id: sessionId,
  command: 'claude',
  cwd: row.cwd,
  args: ['--resume', row.claude_session_id],
  env: { MCODE_SESSION_ID: sessionId },
});
```

This differs from the earlier "spawn a new internal session" idea and is preferred because it preserves layout, sidebar identity, and user context.

### Terminal Output Ring Buffer

Keep the existing implementation model:

- PTY output is buffered in the main process as a capped string, limited to `RING_BUFFER_MAX_BYTES` (currently 100KB).
- On each `onData`, append to the buffer and truncate from the front when over the cap.
- When a terminal tile mounts, `TerminalInstance` fetches replay data before attaching the live `pty:data` listener.
- The buffer naturally disappears when the PTY handle is removed on exit.

This is intentionally simpler than a circular byte buffer and is good enough for the current replay requirement.

### Settings / Preferences

Preferences remain stored as strings in SQLite `preferences` and exposed via IPC. Phase 8 settings are:

| Setting | Type | Default | Phase 8 behavior |
|---|---|---|---|
| `preventSleepEnabled` | boolean | `true` | Already live; keep existing dedicated API |
| `maxConcurrentSessions` | number | `5` | New live setting; changing it updates `TaskQueue` immediately for the next dispatch cycle |
| `hookServerPort` | number | `7777` | Startup-only preference; change requires app relaunch |
| `eventRetentionDays` | number | `7` | Live setting; affects the next prune pass and should also trigger an immediate prune on save |

Explicitly out of scope for this phase:

- Persisted `terminalFontSize`
- Persisted `terminalFontFamily`
- Command palette / global quick switcher settings

Implementation details:

- `TaskQueue` gets a setter such as `setMaxConcurrentSessions(value: number)` and also loads the stored preference during startup.
- `startHookServer()` accepts a preferred starting port instead of always beginning at `HOOK_PORT_DEFAULT`; it still scans the same allowed range if the preferred port is unavailable.
- `SessionManager.pruneOldEvents()` must read the preference value instead of the compile-time constant.
- Saving `eventRetentionDays` should call prune immediately once, not wait for the hourly timer.
- Settings dialog validation:
  - `maxConcurrentSessions`: integer, `1..20`
  - `hookServerPort`: integer, `7777..7799`
  - `eventRetentionDays`: integer, `1..30`

### Activity Feed (Dashboard Tile)

Phase 8 adds an optional dashboard tile with static tile ID `dashboard`.

UI shape:

```
ActivityFeed
|- toolbar
|  |- session filter
|  |- event-type filter
|  `- clear filters
`- event list
   `- EventRow x N
      |- timestamp
      |- session label
      |- event badge
      `- detail text
```

Data contract:

- Keep existing `hooks.onEvent()` as the live stream for all sessions.
- Add a new IPC method for historical cross-session events, for example `hooks.getRecentAll(limit?: number)`.
- Keep the existing session-scoped `hooks.getRecent(sessionId, limit)` API unchanged.
- `ActivityFeed` loads `getRecentAll(200)` on mount, then prepends live `onEvent()` events, trimming the in-memory list back to 200 items.
- Filtering is client-side by `sessionId` and `hookEventName`.
- Session labels and colors come from the existing session store, not duplicated event payload fields.

Tile and layout integration:

- `TileFactory` must recognize `dashboard` and render `ActivityFeed`.
- `layout-store` must gain explicit helpers for adding/removing the dashboard tile so the sidebar can toggle it without pretending it is a session.
- Existing prune logic already preserves non-session leaves; keep that behavior.
- Add an Activity button in the sidebar footer to toggle the dashboard tile.

### macOS Packaging

Use `electron-builder` as the packaging path; the npm scripts already exist.

Required package metadata:

```json
{
  "build": {
    "appId": "com.mcode.app",
    "productName": "mcode",
    "mac": {
      "category": "public.app-category.developer-tools",
      "target": ["dmg"],
      "icon": "resources/icon.icns",
      "hardenedRuntime": true,
      "gatekeeperAssess": false
    },
    "dmg": {
      "contents": [
        { "x": 130, "y": 220 },
        { "x": 410, "y": 220, "type": "link", "path": "/Applications" }
      ]
    }
  }
}
```

Native module considerations:

- `node-pty` and `better-sqlite3` must be rebuilt for the packaged Electron runtime.
- `electron-rebuild` already runs in `postinstall`; no new packaging mechanism is needed.
- `resources/icon.icns` must exist before the final DMG handoff.

### Performance Targets

| Metric | Target |
|---|---|
| App startup to interactive | < 2 seconds |
| New session spawn to first output | < 500ms |
| Terminal input latency | < 16ms (one frame) |
| Terminal rendering at full scroll | 60fps via WebGL |
| Memory per terminal session | ~15-25MB |
| Memory baseline (no sessions) | < 200MB |
| Memory with 10 active sessions | < 500MB |
| Hook event processing latency | < 10ms |
| SQLite write latency | < 1ms (WAL mode) |

---

## Phase 8: Polish & Ship

**Goal:** Finish the remaining UI and plumbing around shortcuts, layout commands, settings, activity feed, and packaging without redesigning already-working core session behavior.

**Build:**

- Migrate app-level shortcuts to Electron menu accelerators: `Cmd+N`, `Cmd+T`, `Cmd+1..9`, `Cmd+]`, `Cmd+[`, `Cmd+\`
- Keep tile-level shortcuts in `TerminalTile`: `Cmd+W`, `Cmd+Shift+W`, `Cmd+D`, `Cmd+Shift+D`, `Cmd+Enter`
- Add persisted `sidebarCollapsed` layout state and command handling for sidebar toggle
- Add split-intent flow and adjacent-tile insertion helpers
- Add transient maximize / restore behavior for the current tile
- Keep resume-in-place behavior for ended Claude sessions
- Keep ring-buffer replay behavior for re-mounted tiles
- Expand settings UI for `maxConcurrentSessions`, `hookServerPort`, and `eventRetentionDays`
- Add dashboard tile + activity feed backed by global hook-history IPC
- Add `electron-builder` package metadata and ship asset pathing
- Run a profiling pass for startup time, 10-session memory footprint, and input latency

**Verify:**

1. `Cmd+N` opens the New Session dialog even when a terminal has focus.
2. `Cmd+T` creates a new terminal session using the currently selected session cwd, or `$HOME` if none is selected.
3. `Cmd+1` focuses the first visible sidebar session; if it has no tile, the tile is opened first.
4. `Cmd+]` and `Cmd+[` move through sessions without triggering browser navigation.
5. `Cmd+\` collapses and restores the sidebar while preserving its previous width.
6. `Cmd+D` on a tile opens the New Session dialog in split-right mode; after creation, the new tile appears to the right of the anchor tile.
7. `Cmd+Shift+D` behaves the same for split-down.
8. `Cmd+Enter` maximizes the current tile; pressing it again restores the previous visible layout for the current run.
9. Ending a Claude session shows **Resume Session**; clicking it reuses the same session card/tile and returns that session to active output.
10. Closing a tile and reopening it from the sidebar replays recent terminal output instead of showing a blank terminal.
11. Changing `maxConcurrentSessions` in Settings changes queue dispatch concurrency without restarting the app.
12. Changing `hookServerPort` in Settings shows restart-required messaging and the new port is used after relaunch.
13. Changing `eventRetentionDays` prunes old events immediately and affects later prune passes.
14. Opening the dashboard tile shows recent events across all sessions and continues updating live.
15. `npm run build:mac` produces a DMG, and a manual install smoke test confirms session spawn, terminal output, and database startup all work.

**Already done and should be preserved:**

- Session resume exists and is implemented as resume-in-place (`SessionManager` + `SessionEndedPrompt`)
- PTY output replay exists with a 100KB capped buffer (`PtyManager` + `TerminalInstance`)
- `Cmd+N`, `Cmd+T`, `Cmd+W`, and `Cmd+Shift+W` semantics already exist, even though some accelerator plumbing still needs to move
- Preferences table and generic preference IPC already exist
- Sleep prevention is already live and preference-backed
- Packaging scripts already exist in `package.json`

**Remaining files likely involved:**

- `src/main/index.ts` — menu accelerators, app-command dispatch, dashboard history IPC
- `src/main/session-manager.ts` — global recent-event query, configurable retention window
- `src/main/task-queue.ts` — runtime concurrency setter / startup preference load
- `src/main/hook-server.ts` — preferred start port support
- `src/preload/index.ts` — app command subscription, dashboard history API, typed preference helpers if added
- `src/shared/types.ts` — `LayoutStateSnapshot.sidebarCollapsed`, `AppCommand` type, `hooks.getRecentAll` API type, and update `MCodeAPI` to include the existing `preferences` namespace (currently untyped) and the new `app.onCommand` subscription
- `src/renderer/App.tsx` — command handling, split-intent orchestration, sidebar collapsed rendering
- `src/renderer/stores/layout-store.ts` — `sidebarCollapsed`, dashboard helpers, adjacent split insertion, maximize restore state
- `src/renderer/components/Layout/TileFactory.tsx` — dashboard tile handling
- `src/renderer/components/Sidebar/Sidebar.tsx` — remove document shortcut listener, add Activity toggle, respect collapsed state
- `src/renderer/components/Sidebar/SessionList.tsx` — extract canonical visible session ordering helper
- `src/renderer/components/Terminal/TerminalTile.tsx` — split / maximize shortcuts
- `src/renderer/components/SettingsDialog.tsx` — expanded settings UI and validation
- `src/renderer/components/Dashboard/ActivityFeed.tsx` — new component
- `package.json` — `build` block for `electron-builder`
- `resources/icon.icns` — required packaging asset

**Tests to add or update:**

- Shortcut coverage for menu accelerators and tile-local commands
- Layout tests for adjacent split insertion and maximize / restore
- Settings tests for live concurrency changes and restart-required port changes
- Activity feed tests for historical load + live append behavior
- Packaging smoke-test checklist for manual release validation
