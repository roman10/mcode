# Changelog

All notable changes to mcode are documented here.

## [0.2.9] — 2026-07-08

### New Features

- **Codex custom prompts as slash commands** — Codex custom prompts are surfaced as slash commands in the palette
- **Auto-label Codex sessions** — sessions are automatically labeled from their first prompt
- **Context-window usage for Codex** — Codex tiles now show live context-window usage, including a dedicated badge
- **Per-model weekly quota limits** — the usage endpoint now surfaces per-model weekly limits (Fable)
- **Claude Fable 5 support** — added claude-fable-5 pricing, family detection, and context window
- **Opus 4.8 support** — added Opus 4.8 pricing, context window, and fast-mode multiplier

### Bug Fixes

- Capture the Codex thread id from the hook for reliable session resume, and project `codex_thread_id` in `getSessionHookState`
- Read the on-disk rollout for Codex session fork/handoff, and restore first-prompt label tracking on reconnect
- Detect Codex approval prompts in the PTY fallback
- Bypass the hook-trust gate for Codex and switch to the stable `hooks` feature flag
- Show Antigravity (agy) in the command palette
- Add pricing for Codex gpt-5.5, gpt-5.2-codex, and gpt-5.1-codex-max
- Deduplicate prompt history entries

## [0.2.8] — 2026-05-24

### New Features

- **Antigravity CLI (agy) support** — Google's Antigravity CLI is now a launchable agent alongside Claude, Codex, Gemini, and Copilot
- **Session handoff to a different CLI** — hand off an existing session to another CLI agent
- **Multi-year stats dashboard** — opens as an overlay with multi-year history, a monthly bar chart in the 90-day view, lines-of-code detail, always-visible value labels, and readable heatmap tooltips
- **Context-window usage badge** — each Claude tile now shows live context-window usage
- **Multi-line shell commands in the `!` palette** — the command palette accepts multi-line shell input
- **Higher scrollback cap** — terminal scrollback raised to 20,000 lines
- **Scrollback-erase suppression toggle** — a Settings option gates suppression of the `\x1b[3J` scrollback-erase sequence

### Bug Fixes

- Keep terminals and editor tiles mounted and correctly sized across maximize/restore and mosaic resize
- Fix WebGL glyph corruption: give each terminal a private atlas and recover atlases after resize, wake, and macOS screen lock
- Detect the 1M-token context window for Opus 4.7 and other 1M-tier models
- Ingest Gemini CLI's new JSONL transcript format
- Attach every image when dragging multiple files onto a Claude tile
- Dedupe Quick Open file results across overlapping working directories
- Replace the dropped Codex `--full-auto` flag with explicit sandbox + approval args
- Defer task dispatch until the PTY settles after a turn ends
- Split the expanded tile when a new session or file is added
- Plug timer, listener, and ref leaks surfaced by a codebase audit

### Other Changes

- Replace the string PTY ring buffer with a byte-based RingBuffer and delta-replay for hidden tabs
- Drive session-state detection from PTY data instead of 2s polling
- Cut renderer allocations and SQLite write cost; reduce store subscription count
- Decompose large modules, split shared types, and consolidate IPC registration under `src/main/ipc/`

## [0.2.7] — 2026-04-26

### New Features

- **xhigh effort level for Claude Code** — adds an extra-high reasoning effort tier to Claude Code sessions
- **Non-cached input tokens in Stats panel** — surfaces uncached input tokens alongside In/Out/Total
- **Sort sessions by last activity** — sessions are now sorted and grouped by last activity time instead of creation time
- **Shell history in `!` palette** — surfaces `$HISTFILE` commands in the `!` shell palette

### Bug Fixes

- Bound terminal scrollback and dispose hidden tiles to stop memory growth
- Fix per-provider cache multipliers in token cost estimation
- Backfill uncached input_tokens for existing Copilot/Codex/Gemini rows
- Store uncached input tokens for Copilot, Codex, Gemini parsers
- Scan per-account state dirs for Copilot, Codex, Gemini token usage
- Route command-palette snippet insertion to bottom-panel terminals

### Other Changes

- Coalesce `session:updated` IPC, memoize SessionCard, and index `attention_level` for sidebar performance
- Batch PTY emits and move dock-badge ownership to the main process

## [0.2.6] — 2026-04-17

### New Features

- **Gemini CLI support** — Gemini account profiles with config isolation and usage quota tracking via the Google Code Assist API
- **Codex account profiles** — generalized hook reconciliation for managing Codex CLI accounts alongside Claude and Gemini
- **Copilot usage quota** — tracks GitHub Copilot usage via the `gh` CLI
- **Unified prompt library** — pinning, save-as-snippet, and `@` prefix lookup in a single view
- **Dialog-based task editing** — inline task editing replaced with a dedicated edit dialog
- **Plan Mode Response improvements** — three-option radio list replaces the Proceed/Revise toggle; merged into the unified CreateTaskDialog; Cmd+Shift+R opens the New Task dialog on the Plan Mode Response tab
- **Claude Opus 4.7 pricing** — token cost tracker now prices claude-opus-4-7 sessions
- **7d/30d averages on stats chart** — bar chart tooltip now shows 7- and 30-day averages with instant hover
- **Styled tooltips** — prompt library action icons now have styled tooltips
- **/mcode-release command** — automated release workflow for mcode itself
- **cleanup-test script** — removes leftover test sessions

### Bug Fixes

- Fix startup crash by moving providerRegistry to module scope
- Split prompt and Enter into two PTY writes so scheduled tasks auto-submit on Claude sessions
- Mount NewSessionDialog at App root so Cmd+N works when the sidebar is collapsed
- Inject Gemini OAuth constants into the Vitest unit test config
- Return 0 instead of null for aiAssisted when no commits exist
- Deduplicate Gemini quota snapshots by Google identity
- Show waiting/starting sessions in the New Task dialog dropdown
- Fix Codex quota not showing (rate_limits moved to payload level)
- Fix Cmd+Shift+R plan mode shortcut blocked in release build
- Refocus terminal after snippet insertion from command palette
- Fix plan mode revise dispatch: text-input navigation, option hint stripping, and missing Enter
- Prevent StatsPanel Cmd+R handler from swallowing Cmd+Shift+R
- Fix plan mode response tasks not dispatching from the New Task dialog
- Show Plan Mode Response toggle after restart; restore promptLabelledSessions
- Wrap CommandPalette in Radix Dialog and render via portal for proper focus stacking
- Clean up loggedPlanModeDeferrals in remaining task cancel/fail paths
- Restore ptyInfoMap on broker recovery and ensure PTY exit ends sessions
- Rename "Plan Response" to "Plan Mode Response" in the New Task dialog
- Use production-available MCP tools in the cleanup-test script
- Fix mcode dispatch

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
