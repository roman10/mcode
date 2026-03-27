# Changelog

All notable changes to mcode are documented here.

## [0.2.0] — 2026-03-27

### New Features

- **Codex CLI sessions** — run and manage OpenAI Codex CLI sessions alongside Claude Code; full hook bridge for session state tracking, resume support, and status detection
- **Model display in tile toolbar** — active model shown in each tile's title bar
- **Signed and notarized DMG** — distributed binary is now signed with Developer ID Application and notarized by Apple; no Gatekeeper prompt on first launch
- **Auto-close on task drain** — session tiles auto-close when their task queue empties (toggle with Cmd+Shift+Q)
- **permissionMode in task queue** — tasks can specify a Shift+Tab mode for automated permission cycling

### Bug Fixes

- Fix WebGL context loss causing invisible cursor in mixed Claude/Codex sessions
- Fix tile cycling (Cmd+[/]) to include file and diff viewer tiles
- Survive `/resume` inside Claude Code CLI without closing the tile
- Fix xterm resize when terminal panel height changes in background Electron window
- Fix auto-close firing for sessions with no tasks; guard against non-idle kills
- Fix new tiles not mirrored into restoreTree when added while maximized
- Strip `ELECTRON_RUN_AS_NODE` from PTY shell environments
- Clear `auto_close` on manual resume to prevent immediate re-kill
- Fix TDZ ReferenceError in session label IIFE
- Fix Codex icon visibility in tile title bar

## [0.1.1] — 2026-03-25

### Bug Fixes

- Preserve user-provided session labels from terminal title overwrites

## [0.1.0] — 2026-03-25

Initial open-source release.

### Core Layout

- Tiling layout (react-mosaic) — see all sessions simultaneously with resizable panes
- Kanban view — drag-and-drop session board with status columns
- VS Code-style bottom terminal panel with tab support and rename
- Maximise/restore any tile with a keyboard shortcut
- Mosaic layout preserved when closing individual tiles

### Session Management

- Spawn and manage multiple Claude Code sessions with node-pty + xterm.js WebGL
- PTY broker — sessions survive app restarts without losing terminal state
- Session search and filter in sidebar
- Focus-next/prev shortcuts cycle through active sessions
- Auto-close tile when session ends; restore on re-open
- Resume session with a different account
- Confirm before closing window with active sessions; kill terminals on close

### Multi-Account Support

- Add multiple Claude Code accounts with isolated credentials (`CLAUDE_CONFIG_DIR`)
- Auto-auth flow with deferred account naming
- Per-session account selection remembered across restarts
- Subscription quota display for all authenticated accounts

### Task Queue

- Dispatch tasks to sessions with priority reordering
- Plan mode automation — task queue drives ExitPlanMode/AskUserQuestion responses
- Slash command autocomplete in task dialog
- Simplified task UI (no advanced options panel)

### Git Integration

- Git commit graph with branch topology visualization in Changes sidebar
- VS Code-style inline staging and discarding in Changes panel
- Auto-refresh Changes badge when git status changes
- Commit history with streak tracking, heatmaps, and cadence analytics

### Analytics

- Unified Stats panel: commit analytics + token usage (cost, model breakdown)
- Subscription usage quota in token stats
- Activity feed with session status events and searchable session dropdown

### Command Palette & Search

- Command palette (Cmd+Shift+P) with fuzzy search across sessions and commands
- Quick open (Cmd+P) for fast session switching
- File content search across repos (Cmd+Shift+F) with ripgrep

### Snippet Palette

- Reusable prompt snippets with variable placeholder support (`{{variable}}`)
- Cmd+Shift+S shortcut and in-app CRUD
- Spaced variable names supported

### Attention System

- Hook-driven monitoring detects when sessions need attention (waiting for input, idle)
- 2-level attention system: action required vs. informational
- StatusBar badge counts; attention clears on session kill or end

### Update Checker

- Background check against GitHub releases
- StatusBar notification with one-click update prompt

### MCP Automation Surface

- 100 MCP tools covering sessions, layout, tasks, git, file search, snippets, and more
- Every UI feature accessible programmatically for agent-driven workflows
- Integration test suite (35 suites) validating all MCP tools

### Developer Experience

- ESLint + typescript-eslint + react-hooks plugin
- Type-safe IPC contract with path aliases
- 2-tier GitHub Actions CI: lint+typecheck+unit on Ubuntu (every push/PR), integration tests on macOS (main only)
- 49 test files (35 integration + 14 unit suites)
- SQLite WAL-mode database with 22 migrations
