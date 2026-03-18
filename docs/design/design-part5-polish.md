# mcode — Part 5: Polish & Ship

> **Phases covered:** 8 (Polish & Ship)
> **Prerequisites:** Part 4 complete (task queue working)
> **Outcome:** Keyboard shortcuts, session resume, settings, activity feed, macOS packaging — ready for daily use
> **Reference:** See `design-v1.md` for full architecture

---

## Architecture Context

### Keyboard Shortcuts

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

**Registration strategy:** Do NOT use Electron's `globalShortcut` (it captures keys system-wide, even when the app is unfocused). Instead:
- **App-level shortcuts** (Cmd+N, Cmd+\, Cmd+1-9, Cmd+K): register as Electron menu accelerators — these fire before xterm captures the keypress.
- **Tile-scoped shortcuts** (Cmd+W, Cmd+Shift+W, Cmd+D, Cmd+Shift+D, Cmd+Enter): handle via `onKeyDown` on the focused tile container, since they need to know which tile is active.
- **Cmd+] / Cmd+[**: these conflict with Electron/Chrome default back/forward navigation. Override them explicitly in the Electron menu (define custom menu items with these accelerators to suppress the default behavior).

### Session Resume

When a session has ended and its `claude_session_id` is known (from hooks):
- Show a "Resume" button on the session card
- Click spawns a new PTY: `claude --resume <claude_session_id>`
- The new PTY gets a new internal `session_id` but carries the old `claude_session_id`
- Session card updates to show resumed state

```typescript
// Resume flow
const newSessionId = uuid();
ptyManager.spawn({
  id: newSessionId,
  cwd: oldSession.cwd,
  args: ['--resume', oldSession.claudeSessionId],
  env: { MCODE_SESSION_ID: newSessionId },
});
```

### Terminal Output Ring Buffer

When a terminal tile is removed from the mosaic but the session is still active:
- PTY output continues buffering in main process
- Ring buffer: circular `Uint8Array`, ~100KB per session, head/tail pointers
- When tile is re-mounted, replay buffer contents to new xterm.js instance via `term.write(buffer)`
- Buffer is cleared when session ends

### Settings / Preferences

Stored in SQLite `preferences` table, exposed via IPC:

| Setting | Type | Default | Description |
|---|---|---|---|
| `maxConcurrentSessions` | number | 5 | Task queue concurrency limit |
| `hookServerPort` | number | 7777 | Preferred hook server port |
| `eventRetentionDays` | number | 7 | Days to keep hook events |
| `terminalFontSize` | number | 13 | Terminal font size |
| `terminalFontFamily` | string | JetBrains Mono | Terminal font |
| `preventSleepEnabled` | boolean | true | Prevent sleep while sessions active (already implemented) |

Settings UI: simple form in a modal or sidebar panel.

### Activity Feed (Dashboard Tile)

Optional tile (tile ID: `dashboard`) showing a real-time stream of hook events across all sessions:

```
ActivityFeed
├── EventRow × N
│   ├── Timestamp
│   ├── Session label (color-coded)
│   ├── Event type badge
│   └── Detail (tool name, error, etc.)
└── Filter controls (by session, by event type)
```

Backed by `hooks.getRecent()` IPC call + `hooks.onEvent()` subscription.

### macOS Packaging

Using `electron-builder`:

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

**Native module considerations:**
- `node-pty` and `better-sqlite3` must be rebuilt for the packaged Electron's Node version
- `electron-rebuild` handles this in the build pipeline
- Verify with: install from .dmg → launch → spawn session → confirm terminal works

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
4. `Cmd+D` on a tile → splits it horizontally, opens new-session dialog for the new pane on the right
5. End a session → "Resume" button appears on session card → click → new PTY with conversation history
6. Close a tile, reopen from sidebar → terminal shows recent output (not blank)
7. Open Settings → change max concurrent sessions → task queue respects new limit
8. `npm run build:mac` produces a working .dmg
9. Install from .dmg → app runs without `npm`, all native modules work
10. 10 concurrent Claude Code sessions → app stays under 500MB, typing latency unnoticeable

**Already done:** Session resume (SessionManager + SessionEndedPrompt), ring buffer (PtyManager, 100KB), Cmd+N/T/W/Shift+W shortcuts, preferences DB + API, sleep prevention, electron-builder scripts
**Files created (remaining):** `src/renderer/components/Dashboard/ActivityFeed.tsx`
**Files modified (remaining):** `src/main/index.ts` (menu accelerators for new shortcuts), `src/renderer/components/Terminal/TerminalTile.tsx` (Cmd+D/Shift+D/Enter), `src/renderer/components/SettingsDialog.tsx` (expand settings UI), `src/renderer/App.tsx`, `package.json` (electron-builder `build` config block)
