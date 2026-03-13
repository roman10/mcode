# mcode — Tech Stack Evaluation & Decision

## What We're Building

An IDE optimized for multi-tasking with coding agents. The core idea: manage multiple autonomous Claude Code sessions simultaneously, with a control panel that surfaces the right things at the right time for human attention.

### Core Requirements

1. **Session lifecycle** — start, close, resume Claude Code sessions
2. **Multi-session control panel** — monitor all sessions, highlight those needing attention
3. **Flexible tiling layout** — split panels, drag-and-drop, resize, rearrange freely
4. **Async collaboration** — queue tasks for sessions, queue tasks for new sessions, schedule tasks
5. **Agent integration** — Claude Code is primary, extensible to other agents
6. **macOS required**, cross-platform a plus

### Key Technical Challenges

The critical technical bottleneck is **terminal emulation with full PTY support**. Each agent session needs a real terminal — not just log output, but full ANSI/256-color/mouse support. Everything else (panels, state, IPC) has well-trodden solutions. Terminal emulation is the differentiator across stacks.

Claude Code provides an HTTP hooks system that POSTs structured JSON (session_id, tool_name, tool_input, cwd, etc.) to a local server on every event (SessionStart, PreToolUse, PostToolUse, Stop, Notification, SessionEnd, SubagentStart/Stop, TaskCompleted). This gives us real-time visibility into what each session is doing, with zero per-session configuration.

---

## Stack Ranking

### Rank 1: Electron + React/TypeScript (Selected)

**Why it wins:** Terminal emulation is the hardest problem here, and Electron has the only fully solved, battle-tested answer: `node-pty` + `xterm.js`. This is exactly what VS Code, Cursor, Windsurf, Hyper, and Tabby all use. Zero invention needed.

| Component | Library |
|---|---|
| Terminal PTY | `node-pty` (spawn real PTY processes) |
| Terminal rendering | `xterm.js` + `@xterm/addon-webgl` |
| Panel layout | `react-mosaic` (tiling WM) or `rc-dock` (dockable tabs) |
| State management | `zustand` |
| Persistence | `better-sqlite3` |
| Build tooling | `electron-vite` + `electron-builder` + `electron-rebuild` |
| IPC | Electron `contextBridge` + `ipcMain`/`ipcRenderer` |

**Pros:**
- node-pty + xterm.js is a solved, production-proven terminal stack
- Fastest path to MVP — working multi-terminal tiling in days, not weeks
- Every successful product in this space chose Electron (VS Code, Cursor, Windsurf, Hyper, Tabby, Theia)
- Full cross-platform: macOS, Windows, Linux
- Huge ecosystem for everything else (file trees, panels, themes)

**Cons:**
- ~150-300MB baseline memory (acceptable for an IDE — users expect IDEs to use 300MB-1GB)
- ~150MB binary size (Chromium bundled)
- Native module compilation (node-pty needs node-gyp), but `electron-rebuild` handles it

---

### Rank 2: Tauri v2 + React/TypeScript

Same React frontend, much lighter binary (~10MB vs 150MB) and less RAM (~30-80MB baseline). But terminal emulation requires building a custom Rust PTY bridge: `portable-pty` crate (from the Wezterm project) piped through Tauri events to xterm.js in the webview. This is uncharted territory — no production terminal emulators are built on Tauri. Adds 1-2 weeks of engineering vs Electron's plug-and-play story. The webview (WKWebView on macOS) also has quirks compared to Chromium.

**Choose if:** Comfortable with Rust and binary size/memory matters more than development speed.

---

### Rank 3: Web App + Local Server

A browser-based dashboard with a Node.js backend. Fastest to prototype, no native build complexity. An earlier iteration of this project explored this approach using tmux as the terminal layer — the browser can't spawn PTY processes directly, so interaction goes through a WebSocket bridge (like `ttyd` or `wetty`), adding a network hop and latency. No native OS integration (system tray, global shortcuts, file watchers). The hook receiver, SQLite persistence, and React UI components from that exploration transfer directly into the Electron approach.

**Choose if:** Want to validate the product concept before investing in a native shell. Can wrap in Electron later.

---

### Rank 4: Native macOS (Swift/AppKit + SwiftTerm)

Best native feel and performance ceiling. `SwiftTerm` handles PTY spawning and ANSI rendering natively. But macOS-only permanently, and no npm ecosystem means building every UI component from scratch — the tiling panel layout alone would take weeks. AppKit has no off-the-shelf tiling WM library.

### Rank 5: Wails (Go + Web)

Go's concurrency model (goroutines, channels) is excellent for process orchestration, but the terminal bridge problem is the same as Tauri with a less mature ecosystem. `github.com/creack/pty` provides PTY support but the webview bridge is custom work. Smaller community means less help at edge cases.

### Rank 6: VS Code Fork

Strong foundation — inherits the gold-standard terminal (node-pty + xterm.js), editor, extension system. But maintaining a fork of ~1.5M lines of TypeScript is prohibitive for a small team. The build system is complex (gulp + webpack + electron). More importantly, our requirements (free-form tiling, task queue, multi-agent orchestration) diverge enough from VS Code's paradigm that we'd fight the framework more than benefit from it. VS Code's layout is powerful but rigid within its own model (sidebar, editor area, panel, auxiliary bar).

### Rank 7: Flutter Desktop

Terminal emulation gap is a showstopper. `xterm.dart` is experimental and far behind xterm.js in capability. Flutter can't use xterm.js because it uses Skia/Impeller rendering, not a webview. You'd spend more time building a terminal renderer than the actual product.

---

## Decision: Electron + React/TypeScript

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                 Electron Main Process                 │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ PTY Manager  │  │ Session      │  │ Task Queue │  │
│  │ (node-pty)   │  │ Lifecycle    │  │ Scheduler  │  │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘  │
│         │                 │                │         │
│  ┌──────┴─────────────────┴────────────────┴──────┐  │
│  │              SQLite (better-sqlite3)            │  │
│  │  sessions, events, task queue, layout state     │  │
│  └─────────────────────┬──────────────────────────┘  │
│                        │ IPC (contextBridge)          │
│  ┌─────────────────────┴──────────────────────────┐  │
│  │        Hook Server (HTTP, port 7777)            │  │
│  │  Receives Claude Code hook events:              │  │
│  │  SessionStart, PreToolUse, PostToolUse, Stop,   │  │
│  │  Notification, SessionEnd, Subagent*, Task*     │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
                         │
┌────────────────────────┼─────────────────────────────┐
│               Electron Renderer Process               │
│                                                       │
│  ┌──────────┐  ┌──────────────────────────────────┐  │
│  │ Sidebar  │  │  react-mosaic tiling layout       │  │
│  │          │  │  ┌──────────┐  ┌──────────────┐  │  │
│  │ Session  │  │  │ xterm.js │  │ xterm.js     │  │  │
│  │ List     │  │  │ Session 1│  │ Session 2    │  │  │
│  │          │  │  ├──────────┤  ├──────────────┤  │  │
│  │ Status   │  │  │ xterm.js │  │ Task Queue / │  │  │
│  │ Monitor  │  │  │ Session 3│  │ Dashboard    │  │  │
│  │          │  │  └──────────┘  └──────────────┘  │  │
│  │ Task     │  └──────────────────────────────────┘  │
│  │ Queue    │                                        │
│  └──────────┘  State: zustand                        │
└──────────────────────────────────────────────────────┘
```

### How It Maps to Requirements

| Requirement | Solution |
|---|---|
| Start/close/resume sessions | PTY Manager spawns `claude` CLI via node-pty; Session Lifecycle Manager tracks state in SQLite |
| Multi-session control panel | Sidebar shows all sessions with status badges; hook events drive real-time status (active/idle/waiting/ended) |
| Attention highlighting | Hook events like `Notification` and `Stop` (permission prompts) trigger visual alerts on session cards |
| Flexible tiling layout | react-mosaic provides drag-and-drop tiling WM; layout state persisted to SQLite |
| Async task queue | Task Queue in main process manages pending tasks; auto-dispatches to idle sessions or spawns new ones |
| Agent extensibility | Each agent type is a PTY process adapter; Claude Code is first, others follow the same interface |

### Database Schema

```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  cwd TEXT,
  permission_mode TEXT,
  transcript_path TEXT,
  status TEXT DEFAULT 'active',        -- active | idle | waiting | ended
  started_at TEXT,
  last_event_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  hook_event_name TEXT NOT NULL,       -- SessionStart, PreToolUse, etc.
  tool_name TEXT,                      -- Bash, Edit, Read, etc.
  tool_input TEXT,                     -- JSON of tool_input
  payload TEXT NOT NULL,               -- Full raw JSON
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_session ON events(session_id, created_at);

CREATE TABLE task_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT NOT NULL,
  cwd TEXT,
  target_session_id TEXT,              -- NULL = create new session
  status TEXT DEFAULT 'pending',       -- pending | dispatched | completed
  scheduled_at TEXT,                   -- NULL = ASAP
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Hook Configuration

Claude Code hooks are configured in `~/.claude/settings.json`. All events use HTTP hooks that POST to the Electron-hosted server:

```json
{
  "hooks": {
    "PreToolUse":    [{ "hooks": [{ "type": "http", "url": "http://localhost:7777/hook", "timeout": 5 }] }],
    "PostToolUse":   [{ "hooks": [{ "type": "http", "url": "http://localhost:7777/hook", "timeout": 5 }] }],
    "Stop":          [{ "hooks": [{ "type": "http", "url": "http://localhost:7777/hook", "timeout": 5 }] }],
    "Notification":  [{ "hooks": [{ "type": "http", "url": "http://localhost:7777/hook", "timeout": 5 }] }],
    "SessionStart":  [{ "hooks": [{ "type": "http", "url": "http://localhost:7777/hook", "timeout": 5 }] }],
    "SessionEnd":    [{ "hooks": [{ "type": "http", "url": "http://localhost:7777/hook", "timeout": 5 }] }],
    "SubagentStart": [{ "hooks": [{ "type": "http", "url": "http://localhost:7777/hook", "timeout": 5 }] }],
    "SubagentStop":  [{ "hooks": [{ "type": "http", "url": "http://localhost:7777/hook", "timeout": 5 }] }],
    "TaskCompleted": [{ "hooks": [{ "type": "http", "url": "http://localhost:7777/hook", "timeout": 5 }] }]
  }
}
```

Graceful degradation: if mcode is not running, hooks timeout silently and Claude Code sessions are unaffected.

## Next Steps

1. Project scaffolding and build setup (Electron + Vite + React)
2. Core PTY manager and session lifecycle design
3. UI component hierarchy and tiling layout system
4. Hook integration and real-time monitoring
5. Task queue and scheduling architecture
