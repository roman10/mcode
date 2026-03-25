# Competitive Landscape — March 2026

Research on tools similar to mcode: desktop apps, TUIs, and orchestration layers for managing multiple AI coding agent sessions.

---

## First-Party / Platform Tools

### Claude Code Desktop (Anthropic)
- **URL**: https://code.claude.com/docs/en/desktop
- **Open source**: No
- **Key features**: Native GUI for Claude Code, visual diff review, session sidebar, git worktree integration, permission modes
- **Multi-session**: Sidebar-based — can run multiple sessions but **single-pane view only** (one session visible at a time)
- **Recent updates (Feb–Mar 2026)**: Agent Teams with TeammateTool and Swarm Mode (parallel agents with dedicated worktrees), Opus 4.6 (1M context), voice mode, `/loop` for recurring tasks, session naming (`-n`), `/color` for visual distinction, Computer Use (Mar 24). Default output tokens raised to 64k (128k upper bound).
- **vs mcode**: No tiling layout, no kanban, no multi-account, no task queue, no MCP automation surface. Open feature request for multi-window: https://github.com/anthropics/claude-code/issues/30154

### OpenAI Codex App
- **URL**: https://openai.com/index/introducing-the-codex-app/
- **Open source**: No
- **Key features**: Desktop command center for parallel Codex agents, git worktree isolation, subagent orchestration, Automations
- **Platforms**: macOS (Apple Silicon), Windows
- **vs mcode**: Closest in vision but tied to OpenAI ecosystem. mcode is Claude-Code-first with terminal-native approach.

### Claude Code Agent Teams
- **URL**: https://code.claude.com/docs/en/agent-teams
- **Key features**: One session as team lead coordinating independent teammates via TeammateTool. Swarm Mode for fully parallel peer agents. CLI-level feature, not a GUI.
- **vs mcode**: No visual layer. mcode provides the GUI that Agent Teams lacks.

### Cursor
- **URL**: https://cursor.sh/
- **Open source**: No
- **Key features**: Composer 2 proprietary model (launched Mar 19, 2026; 61.7% Terminal-Bench 2.0), up to 8 parallel agents, Plan Mode with editable Markdown task planning, redesigned multi-agent interface
- **Pricing**: Composer 2 at $0.50/$2.50 per 1M tokens (Standard), $1.50/$7.50 (Fast)
- **vs mcode**: Full IDE with agent features. mcode is a session manager, not a code editor — orthogonal positioning. Cursor users would run Claude Code sessions inside mcode.

### Windsurf (Codeium)
- **URL**: https://windsurf.com/
- **Open source**: No
- **Key features**: Wave 13 — parallel Cascade agent sessions with dedicated terminal profiles, Arena Mode (hidden-identity side-by-side model comparison), Cascade Hooks for pre/post-action code standards enforcement
- **vs mcode**: IDE paradigm, not session-manager. Windsurf users can still benefit from mcode for managing Claude Code externally.

### Warp 2.0
- **URL**: https://www.warp.dev/
- **Open source**: No
- **Key features**: Agent Management Panel, status monitoring, desktop notifications, Oz cloud agents with Full Terminal Use and Computer Use, Warp Bridge MCP extension
- **vs mcode**: General-purpose terminal with agent features bolted on. mcode is purpose-built for multi-session Claude Code.

### VS Code Multi-Agent
- **URL**: https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development
- **Key features**: Run Claude, Codex, and Copilot agents alongside each other. Release 1.111 (Mar 2026) added Agent permissions, Autopilot (Preview), Agent-scoped hooks, and Agent troubleshooting.
- **vs mcode**: IDE paradigm (code editor with agents) vs. mcode's terminal-native tiling paradigm.

### GitHub Copilot Workspaces
- **URL**: https://githubnext.com/projects/copilot-workspace
- **Open source**: No
- **Key features**: Browser-based multi-agent environment connected directly to GitHub Issues and PRs, spec → plan → code → PR workflow
- **vs mcode**: Cloud/browser-based, GitHub-issue-centric. mcode is local, terminal-native.

---

## Desktop GUI Competitors

### Opcode (formerly Claudia)
- **URL**: https://github.com/winfunc/opcode | opcode.sh
- **Open source**: Yes (AGPL)
- **Tech**: Tauri 2 + React + TypeScript + Rust
- **GitHub stars**: ~21K
- **Key features**: Session checkpoints (rewind conversations), visual project browser, CLAUDE.md editor, usage analytics, custom agents. Building open-model-based coding agent targeting SOTA benchmarks.
- **Platforms**: macOS, Linux, Windows
- **vs mcode**: Opcode focuses on single-session enhancement. mcode focuses on multi-session orchestration with tiling, kanban, task queue, and 100 MCP tools. Different niches.

### Nimbalyst (formerly Crystal)
- **URL**: https://nimbalyst.com/ | https://github.com/stravu/crystal
- **Open source**: Free for individual users (Crystal predecessor was OSS; Nimbalyst is commercial SaaS)
- **Key features**: Multi-session kanban board (6+ parallel sessions), automatic status tracking, visual diff review, git worktree isolation, markdown editor, diagramming, iOS mobile app. Now supports both Claude Code and OpenAI Codex side-by-side.
- **Platforms**: macOS, Windows, Linux
- **vs mcode**: Most similar in concept. Nimbalyst uses kanban-only; mcode has both tiling and kanban. Nimbalyst supports Codex natively; mcode is Claude-Code-first. mcode adds multi-account, 100 MCP tools, task queue, and commit/token analytics.

### Quack
- **URL**: https://www.quack.build/
- **Tech**: Tauri + React (~8MB)
- **Key features**: 10-30+ parallel sessions, visual terminals, Kanban view, multi-model support (Ollama, DeepSeek), free unlimited agents
- **vs mcode**: Similar scope but no tiling layout, no multi-account, no task queue, no MCP automation. Lighter weight (Tauri vs Electron).

### Dorothy
- **URL**: https://dorothyai.app/ | https://github.com/Charlie85270/Dorothy
- **Open source**: Yes
- **Key features**: 10+ agents simultaneously across projects, 5 built-in MCP servers with 40+ tools, Kanban with auto-assignment, GitHub PR/issue automation triggers, Super Agent orchestration via MCP, Telegram/Slack notifications, "delightfully retro" aesthetic
- **vs mcode**: Automation-focused (trigger agents on GitHub events, external notifications). mcode is hands-on terminal management with deeper MCP surface (100 tools vs 40+).

### ClaudeTerminal
- **URL**: https://github.com/Mr8BitHK/claude-terminal
- **Open source**: Yes
- **Tech**: Electron 40 + React 19 + xterm.js + Tailwind CSS v4
- **Key features**: Tabbed terminal sessions, status indicators, session persistence, worktree support
- **Platforms**: Windows-focused
- **vs mcode**: **Nearly identical tech stack.** Uses tabs, mcode uses tiling + kanban. mcode adds multi-account, task queue, 100 MCP tools, commit/token analytics, command palette, and SQLite persistence.

### Sculptor (Imbue)
- **URL**: https://github.com/imbue-ai/sculptor
- **Open source**: Yes
- **Key features**: Containerized agent execution, Pairing Mode (bidirectional IDE sync), parallel execution in isolated containers
- **Platforms**: macOS (Apple Silicon), Linux
- **vs mcode**: Container-first approach (stronger isolation, heavier). mcode is terminal-native and lighter.

### CodePilot
- **URL**: https://github.com/op7418/CodePilot
- **Open source**: Yes
- **Tech**: Electron + Next.js
- **Key features**: Chat-based GUI wrapper, session management, file tree, MCP server management
- **vs mcode**: Chat-wrapper approach. mcode is terminal-native with real xterm.js rendering.

### Kintsugi (SonarSource)
- **URL**: https://sonarsource.github.io/kintsugi-docs/
- **Open source**: Documentation open; app proprietary
- **Key features**: Multi-threaded development, Sonar-powered code guardrails for reviewing AI code
- **Platforms**: macOS only
- **vs mcode**: Focuses on code review quality, not session management. Complementary positioning.

---

## CLI / TUI Session Managers

### CCManager
- **URL**: https://github.com/kbwo/ccmanager
- **Key features**: 8+ agent types, devcontainer integration, worktree hooks, multi-project
- **vs mcode**: CLI-only, no GUI. Broader agent support but no visual tiling.

### Agent of Empires (aoe)
- **URL**: https://github.com/njbrake/agent-of-empires
- **Tech**: Rust TUI
- **Key features**: TUI dashboard, 8+ agents, Docker sandboxing, tmux sessions
- **vs mcode**: TUI approach. Uses tmux vs. mcode's xterm.js.

### Agent Deck
- **URL**: https://github.com/asheshgoplani/agent-deck
- **Tech**: Go
- **Key features**: TUI + web UI, token tracking, "Conductors" (auto-responding orchestrating agents), cost monitoring. Supports Claude, Gemini, OpenCode, Codex.
- **vs mcode**: Monitoring/orchestration focused vs. mcode's hands-on terminal tiling.

### Account Management CLI Tools
- **ccswitch** (https://github.com/ksred/ccswitch) — worktree management for parallel sessions
- **CCS** (https://github.com/kaitranntt/ccs) — account switching, multi-model support via proxy
- **claude-env** — multiple account management

---

## Orchestration / Kanban Layer

### Vibe Kanban (BloopAI)
- **URL**: https://github.com/BloopAI/vibe-kanban | vibekanban.com
- **Open source**: Yes (Apache 2.0)
- **GitHub stars**: ~13.8K
- **Funded**: Y Combinator
- **Key features**: Kanban-based planning, workspace creation, inline diff review, browser preview, 10+ agent support (Claude Code, Codex, Amp, Cursor Agent CLI, Gemini, and more)
- **vs mcode**: Kanban-first workflow (plan → execute → review). mcode is terminal-first. Different paradigms.

### Mission Control
- **URL**: https://github.com/builderz-labs/mission-control
- **Open source**: Yes (MIT)
- **Key features**: 28 dashboard panels, WebSocket + SSE real-time updates, GitHub Issues sync, cost tracking, SQLite-powered
- **vs mcode**: Agent fleet dashboard vs. mcode's terminal tiling IDE.

---

## mcode's Unique Position

| Feature | mcode | Competitors with it |
|---|---|---|
| **Tiling layout** (live multi-session view) | Yes | Almost none (most use tabs/sidebar) |
| **Kanban view** (drag-and-drop session board) | Yes | Nimbalyst, Quack, Vibe Kanban, Dorothy |
| **Terminal-native** (node-pty + xterm.js WebGL) | Yes | ClaudeTerminal, Agent of Empires |
| **Multi-account support** | Yes | Only CLI tools (CCS, claude-env) |
| **100 MCP tools** (full automation surface) | Yes | None at this depth (Dorothy: 40+) |
| **Task queue** (scheduled dispatch with priority) | Yes | Dorothy (GitHub-triggered), Agent Deck (Conductors) |
| **Command palette + quick open** | Yes | Opcode, Kintsugi |
| **Commit analytics** (streaks, heatmaps, cadence) | Yes | Mission Control (basic) |
| **Token usage tracking** (cost, model breakdown) | Yes | Agent Deck, Mission Control |
| **Hook-driven monitoring** (attention system) | Yes | None at this depth |
| **File viewer** (read-only code tiles) | Yes | Opcode (project browser), Sculptor (IDE sync) |
| **Desktop app** | Yes | Many |
| **PTY persistence** (sessions survive restarts) | Yes | None |
| **Git commit graph** (branch topology viz) | Yes | None |
| **Plan mode automation** (task queue driven) | Yes | None |
| **VSCode-style staging/discarding** | Yes | Sculptor (IDE sync) |
| **Snippet palette** (reusable prompt snippets) | Yes | None |
| **Purpose-built for Claude Code** | Yes | Opcode, Quack, Nimbalyst |
| **SQLite-backed persistence** (20 migrations) | Yes | Few |
| **51 keyboard shortcuts** | Yes | Opcode, Kintsugi |

No single competitor matches the combination of tiling + kanban + multi-account + terminal-native + 100 MCP tools + task queue + hook-driven monitoring + commit/token analytics.

---

## mcode Competitive Ranking

**Where mcode stands as of March 2026, among Claude-Code-specific session managers:**

| Rank | Tool | Rationale |
|---|---|---|
| **1** | **mcode** | Most complete feature set for power users: tiling + kanban + terminal-native + multi-account + deepest MCP surface + analytics. Unique on tiling, PTY persistence, commit graph, plan mode automation. |
| **2** | **Nimbalyst** | Most polished visual experience; only tool with mobile iOS access; native Codex+Claude support. Lags on MCP depth, multi-account, analytics, and lacks tiling. |
| **3** | **Vibe Kanban** | Well-funded (YC), strong community (13.8K stars), broadest multi-agent support. Kanban-first workflow, no terminal tiling. |
| **4** | **Quack** | Good free option for parallelism without setup overhead. No multi-account, no task queue, lighter MCP surface. |
| **5** | **Dorothy** | Best automation/notification story (GitHub triggers, Telegram/Slack). 40+ MCP tools. Weaker terminal-native feel. |
| **6** | **Opcode** | Best single-session enhancement (checkpoints, custom agents). Not designed for multi-session orchestration. |

**Honest caveats for mcode's #1 position:**
- **Not yet released** — competitors are live products with real user feedback loops
- **Electron vs Tauri**: Quack and Opcode ship smaller binaries; mcode's Electron base is heavier
- **Claude-only**: Nimbalyst and Quack support Codex/multi-model; mcode is single-vendor by design (a risk if Claude Code loses market share)
- **No mobile**: Nimbalyst has iOS; mcode is desktop-only
- The gap will compress as competitors iterate — mcode needs to ship and build community moat

---

## Demand Signals

- "Agentmaxxing" is a known workflow pattern — teams run 4-5+ parallel agents by default (e.g., incident.io)
- February 2026: every major platform shipped parallel multi-agent features within two weeks (Grok Build, Windsurf Wave 13, Claude Agent Teams, Codex CLI, Devin)
- Claude Code added Computer Use (Mar 24, 2026) — raises the ceiling for automation surfaces like mcode's task queue
- Multiple Show HN posts for session managers; awesome-claude-code lists 20+ orchestrators
- Key unsolved pain points: context switching between tabs, status visibility, multi-account rate limits, lack of automation/MCP surfaces for agent-driven workflows
- Git worktree isolation becoming standard across all tools

---

## Sources

- [Claude Code Desktop Docs](https://code.claude.com/docs/en/desktop)
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Opcode GitHub](https://github.com/winfunc/opcode)
- [Nimbalyst](https://nimbalyst.com/)
- [Quack](https://www.quack.build/)
- [ClaudeTerminal GitHub](https://github.com/Mr8BitHK/claude-terminal)
- [Sculptor GitHub](https://github.com/imbue-ai/sculptor)
- [Vibe Kanban GitHub](https://github.com/BloopAI/vibe-kanban)
- [Dorothy](https://dorothyai.app/)
- [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)
- [awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators)
