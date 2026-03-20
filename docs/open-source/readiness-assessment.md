# Open-Source Readiness Assessment — March 2026

## Verdict

**Worth open-sourcing.** mcode occupies a unique niche (tiling + multi-account + terminal-native) that no competitor fills. The space is crowded (~25 tools) but differentiated enough to stand out. Market timing favors launching now before first-party tools (Claude Code Desktop) add multi-window support.

---

## Scorecard

| Dimension | Score | Notes |
|---|---|---|
| Feature completeness | 9/10 | Tiling + kanban views, command palette, quick open, file viewer, task queue, commit/token tracking, settings UI, 82 MCP tools. Missing: auto-update |
| Code quality | 9/10 | Clean architecture, good naming, proper separation, zero TODOs |
| Documentation (internal) | 8/10 | Excellent design docs, ADRs, architecture walkthroughs |
| Documentation (external) | 3/10 | No LICENSE, CONTRIBUTING.md, SECURITY.md, build guide |
| Dependencies | 9/10 | Minimal, modern, no security issues. Only concern: react-mosaic beta |
| Build system | 8/10 | Works. electron-vite + electron-builder. No cross-platform CI |
| Tests | 9/10 | 169 tests across 26 suites, all passing |
| CI/CD | 0/10 | None exists |
| Security | 7/10 | No secrets, CSP configured, context isolation. Fine for desktop |
| Release process | 0/10 | No automation, no installers, no auto-update |

**Overall: 6/10 — needs external docs and CI/CD before public launch**

---

## Blockers (must fix before launch)

1. **No LICENSE file** — choose Apache 2.0 (permissive, enterprise-friendly) or AGPL (like Opcode, prevents proprietary forks)
2. **No CI/CD** — GitHub Actions for test + build on push
3. **No CONTRIBUTING.md** — external contributors need onboarding
4. **No README for open-source** — need installation instructions, screenshots, feature overview

## Nice-to-haves (post-launch)

- SECURITY.md for vulnerability reporting
- CHANGELOG generation
- Release automation (GitHub Releases with DMG artifacts)
- Cross-platform CI (currently macOS-only)
- Auto-update mechanism

---

## Estimated Effort to Launch

| Task | Effort |
|---|---|
| Add LICENSE | 1 hour |
| Write CONTRIBUTING.md | 1 day |
| Rewrite README (screenshots, install, features) | 1-2 days |
| Set up GitHub Actions CI/CD | 2-3 days |
| Polish pass (remove debug code, clean warnings) | 1-2 days |
| **Total** | **~1 week** |

---

## Positioning Strategy

**Tagline:** "Terminal-native tiling IDE for parallel Claude Code sessions"

**Key differentiators to emphasize:**
1. **See all sessions at once** — react-mosaic tiling + kanban view, not tabs or sidebar
2. **Multi-account support** — bypass rate limits, isolate work contexts
3. **Real terminal** — node-pty + xterm.js WebGL, not a chat wrapper
4. **Deep Claude Code integration** — hook-driven monitoring, attention system, token tracking
5. **82 MCP tools** — fully automatable via MCP; every feature is agent-accessible
6. **Task queue** — schedule and dispatch work to sessions with priority and retry logic
7. **Built-in analytics** — commit tracking (streaks, heatmaps, cadence) + token usage (cost, model breakdown)
8. **Command palette + quick open** — VS Code-style navigation with fuzzy search

**Positioning against competitors:**
- vs **Opcode** (21K stars): "Opcode enhances a single session. mcode lets you see, manage, and orchestrate many at once with tiling, kanban, and a task queue."
- vs **Nimbalyst/Quack**: "Terminal-native with real xterm.js, not a chat wrapper. Plus multi-account, 82 MCP tools, and built-in commit/token analytics."
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

- [ ] Choose and add LICENSE file
- [ ] Write CONTRIBUTING.md (dev setup, PR process, code style)
- [ ] Rewrite README.md (screenshots, features, installation, quick start)
- [ ] Set up GitHub Actions (lint, test, build on macOS)
- [ ] Tag v0.1.0 release
- [ ] Prepare Show HN post
- [ ] Share in Claude Code community channels
