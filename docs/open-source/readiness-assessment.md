# Open-Source Readiness Assessment — March 2026

## Verdict

**Worth open-sourcing.** mcode occupies a unique niche (tiling + multi-account + terminal-native) that no competitor fills. The space is crowded (~25 tools) but differentiated enough to stand out. Market timing favors launching now before first-party tools (Claude Code Desktop) add multi-window support.

---

## Scorecard

| Dimension | Score | Notes |
|---|---|---|
| Feature completeness | 10/10 | Tiling + kanban views, command palette, quick open, file viewer, task queue, commit/token tracking, settings UI, 96 MCP tools, update checker, PTY persistence, git commit graph, VSCode-style staging, snippet palette |
| Code quality | 9/10 | Clean architecture, good naming, proper separation, zero TODOs. ESLint + typescript-eslint added, type-safe IPC contract |
| Documentation (internal) | 8/10 | Excellent design docs, ADRs, architecture walkthroughs |
| Documentation (external) | 5/10 | LICENSE (Apache 2.0) and CONTRIBUTING.md added. Still missing: SECURITY.md, build guide, proper README |
| Dependencies | 9/10 | Minimal, modern, no security issues. Only concern: react-mosaic beta |
| Build system | 8/10 | Works. electron-vite + electron-builder. No cross-platform CI |
| Tests | 9/10 | 45 test files across 36+ suites, all passing |
| CI/CD | 7/10 | 2-tier GitHub Actions: lint+typecheck+unit on Ubuntu (every push/PR), integration tests on macOS (main only). Missing: release automation, cross-platform build |
| Security | 7/10 | No secrets, CSP configured, context isolation. Fine for desktop |
| Release process | 3/10 | Update checker with StatusBar notification exists. No installers or release automation |

**Overall: 8/10 — README is the sole remaining blocker before public launch**

---

## Blockers (must fix before launch)

1. ~~**No LICENSE file**~~ — Added Apache 2.0 (`d4702e6`)
2. ~~**No CI/CD**~~ — 2-tier GitHub Actions added: lint+typecheck+unit on Ubuntu, integration tests on macOS
3. ~~**No CONTRIBUTING.md**~~ — Added (`db45c95`)
4. **No README for open-source** — need installation instructions, screenshots, feature overview

## Nice-to-haves (post-launch)

- SECURITY.md for vulnerability reporting
- CHANGELOG generation
- Release automation (GitHub Releases with DMG artifacts)
- Cross-platform CI (currently macOS-only)
- ~~Auto-update mechanism~~ — update checker implemented (StatusBar notification + GitHub releases)

---

## Estimated Effort to Launch

| Task | Effort |
|---|---|
| ~~Add LICENSE~~ | ~~1 hour~~ |
| ~~Write CONTRIBUTING.md~~ | ~~1 day~~ |
| Rewrite README (screenshots, install, features) | 1-2 days |
| ~~Set up GitHub Actions CI/CD~~ | ~~2-3 days~~ |
| ~~Polish pass (remove debug code, clean warnings)~~ | ~~Done (zero TODOs, ESLint clean)~~ |
| **Total remaining** | **~1-2 days** |

---

## Next Priority: README Rewrite

The README is the **sole remaining blocker**. The current README is 16 lines with no installation instructions, screenshots, or feature overview. A proper open-source README needs:

1. **Hero section** — tagline, one-paragraph description, screenshot or GIF of tiling layout
2. **Feature overview** — highlight the 11 key differentiators (tiling, kanban, task queue, 96 MCP tools, etc.)
3. **Installation** — prerequisites (macOS, Node 22+, Claude Code CLI), clone + `npm install` + `npm run dev`
4. **Quick start** — create first session, use command palette, queue a task
5. **Screenshots** — tiling view, kanban view, command palette, commit graph, token analytics
6. **Links** — CONTRIBUTING.md, LICENSE, issue tracker

Once the README is done, the project is ready for v0.1.0 tag and Show HN.

---

## Positioning Strategy

**Tagline:** "Terminal-native tiling IDE for parallel Claude Code sessions"

**Key differentiators to emphasize:**
1. **See all sessions at once** — react-mosaic tiling + kanban view, not tabs or sidebar
2. **Multi-account support** — bypass rate limits, isolate work contexts
3. **Real terminal** — node-pty + xterm.js WebGL, not a chat wrapper
4. **Deep Claude Code integration** — hook-driven monitoring, attention system, token tracking
5. **96 MCP tools** — fully automatable via MCP; every feature is agent-accessible
6. **Task queue** — schedule and dispatch work to sessions with priority and retry logic
7. **Built-in analytics** — commit tracking (streaks, heatmaps, cadence) + token usage (cost, model breakdown)
8. **Command palette + quick open** — VS Code-style navigation with fuzzy search
9. **PTY persistence** — sessions survive app restarts via PTY broker
10. **Git commit graph** — branch topology visualization in Changes sidebar
11. **VSCode-style staging** — stage and discard changes inline, no separate git client needed

**Positioning against competitors:**
- vs **Opcode** (21K stars): "Opcode enhances a single session. mcode lets you see, manage, and orchestrate many at once with tiling, kanban, and a task queue."
- vs **Nimbalyst/Quack**: "Terminal-native with real xterm.js, not a chat wrapper. Plus multi-account, 96 MCP tools, and built-in commit/token analytics."
- vs **Claude Code Desktop**: "Tiling layout to see all sessions simultaneously, plus multi-account, task queue, and full MCP automation."
- vs **CLI tools**: "Full desktop GUI with tiling, kanban, command palette, and analytics — not just a TUI or CLI wrapper."

---

## Risks

1. **Claude Code Desktop** will likely add multi-window/tiling eventually (feature request exists)
2. **Opcode** has 21K+ stars — massive community momentum sets high quality expectations
3. **Vibe Kanban** is YC-funded with strong traction in the orchestration space
4. The space is extremely crowded (20+ tools in awesome-claude-code orchestrator list alone)
5. **ClaudeTerminal** has nearly identical tech stack and could converge on similar features
6. Maintenance burden of open-source community management

---

## Launch Checklist

- [x] Choose and add LICENSE file (Apache 2.0)
- [x] Write CONTRIBUTING.md (dev setup, PR process, code style)
- [ ] Rewrite README.md (screenshots, features, installation, quick start)
- [x] Set up GitHub Actions (lint, test, build on macOS)
- [ ] Tag v0.1.0 release
- [ ] Prepare Show HN post
- [ ] Share in Claude Code community channels
