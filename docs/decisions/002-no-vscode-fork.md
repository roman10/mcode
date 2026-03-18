# ADR-002: Do not fork VS Code

**Status:** Accepted
**Date:** 2026-03-18

## Context

mcode is a desktop session orchestrator for managing multiple autonomous Claude Code sessions — not a code editor. Users don't edit code in mcode; they manage agents that edit code elsewhere. The codebase is ~9,074 LOC across 59 files, built on Electron 41 + React 19 + TypeScript 5.9. The initial tech-stack evaluation (`docs/design/tech-stack.md`) ranked VS Code fork at #6. This ADR revisits that decision with a working product and provides a thorough analysis.

## Decision

**Stay on the current custom Electron stack. Do not fork VS Code.**

## Analysis

### What VS Code would provide vs. what mcode needs

| Capability | mcode already has? | LOC in mcode | Would mcode use it? |
|---|---|---|---|
| Terminal (node-pty + xterm.js) | Yes | ~500 | Partially — VS Code's terminal model lacks session lifecycle |
| Multi-tab/split layout | Yes (react-mosaic) | ~420 | No — VS Code's layout is editor-centric, not terminal-mosaic |
| Keybinding system | Yes | ~150 | Partially |
| Code editor (Monaco) | No | 0 | No — mcode is not an editor |
| Extension API | No | 0 | No — mcode uses MCP instead |
| Command palette | No | 0 | Maybe — ~300 LOC to build with `cmdk` |
| Settings framework | Minimal | 24 | Maybe — ~500 LOC to build properly |
| Cross-platform | Yes (Electron) | 0 | Already have it |
| Auto-update | No | 0 | ~100 LOC with `electron-updater` |
| Accessibility, i18n | No | 0 | Not needed yet |
| File explorer, SCM, debug | No | 0 | No |

VS Code's main value (editor, extensions, language servers) is irrelevant. The features mcode could reuse (terminal, layout, keybindings) are already built in ~1,070 LOC.

### The fork tax

**Codebase size:** mcode is 9,074 LOC. VS Code core is ~1.5-2M LOC — a 165-220x increase.

**What must be ported (no VS Code equivalent):**

| mcode Subsystem | LOC | Porting Difficulty | Why |
|---|---|---|---|
| SessionManager (lifecycle state machine) | 971 | High | VS Code terminal has no concept of managed sessions with states |
| TaskQueue (orchestration + retry) | 462 | High | VS Code Tasks are build tasks, not agent orchestration |
| MCP DevTools server (50+ tools) | 1,548 | High | Must bridge VS Code APIs instead of direct IPC |
| HookServer + HookConfig | 331 | Low | Standalone, but wiring to VS Code UI is complex |
| Attention system (dock badges) | ~200 | Medium | VS Code has notifications but not 4-level attention escalation |
| SQLite database (5 tables, 9 migrations) | 79 + SQL | High | VS Code uses IndexedDB + JSON files |
| Custom sidebar (session cards, task panel) | ~711 | Medium | VS Code TreeView API too limited; would need Webview |
| Activity feed dashboard | 175 | Medium | Would be a Webview panel |
| Sleep blocker | 89 | Low | Straightforward |

~4,566 LOC (50% of codebase) must be ported into a framework not designed for these patterns.

**Layout incompatibility — the critical blocker.** VS Code's layout is rigid: `[ActivityBar][Sidebar][EditorGroups][Panel][AuxSidebar]`. mcode's layout is `[Sidebar][Free-form Mosaic of Terminal Tiles + Dashboard]`. To replicate mcode's mosaic in VS Code, you'd build a Webview that recreates the entire layout inside VS Code — gaining nothing while adding Webview communication overhead.

**Monthly rebase burden.** VS Code releases monthly, touching hundreds of files. Cursor reportedly has 3-5 engineers dedicated to fork maintenance. For a small team, prohibitive.

**Build system regression.** mcode's build: `electron-vite` (27 LOC config). VS Code's build: `gulp` + `webpack` + hundreds of build scripts.

### Evidence from existing forks

| Fork | Why they forked | Lesson for mcode |
|---|---|---|
| **Cursor** | Building a code editor — needs VS Code's editor | Justified because they need the editor |
| **Windsurf** | Same — code editor with AI | Same justification |
| **VSCodium** | Minimal changes (de-Microsofting) | Even trivial forks struggle with timely releases |
| **code-server** | VS Code in browser | Significant ongoing effort by a team at Coder |
| **Theia** | Built VS Code-compatible IDE from scratch to AVOID fork | Explicitly chose not to fork |

All successful forks need the code editor. mcode does not.

### What's missing is cheap to build

| Missing Feature | Estimated LOC | Approach |
|---|---|---|
| Command palette | 300-500 | `cmdk` library |
| Richer settings UI | 300-500 | React component |
| Auto-update | ~100 | `electron-updater` |
| Inline code viewing (if ever needed) | ~200 | Monaco Editor as standalone npm package |
| Cross-platform polish | Minimal | Already cross-platform via Electron; needs testing |

Total: ~1,000-1,300 LOC for everything users might ask for. Compare to inheriting 1.5M+ LOC.

### Competitive positioning

| Product | Category | Needs editor? |
|---|---|---|
| Cursor, Windsurf | AI code editors (VS Code forks) | Yes — that's the product |
| Warp, iTerm2, Kitty | Terminal emulators | No |
| tmux | Terminal multiplexer | No |
| **mcode** | **Agent orchestrator / mission control** | **No** |

Adopting VS Code's shell positions mcode as "yet another AI code editor fork" in a crowded market where it would lack editor features to differentiate. The distinctive UX — session cards with attention indicators, free-form terminal mosaic, activity feed, task queue — communicates a novel product category.

## Key factors

1. **Product identity**: mcode is an agent orchestrator, not a code editor. VS Code's value is its editor and extension ecosystem — neither needed.
2. **Architecture fit**: mcode's core innovations (session lifecycle, hook events, attention, task queue, MCP automation) have no VS Code counterparts and would need to be rebuilt on an incompatible framework.
3. **Maintenance economics**: Fork maintenance requires dedicated engineering just to stay current — justified only when you need the editor.
4. **Development velocity**: 9K LOC you fully own >> 1.5M LOC you partially understand.
5. **Competitive positioning**: Novel agent orchestrator >> Cursor clone #47.
6. **MCP-first design**: Every feature is automatable via MCP tools with direct IPC access. VS Code's extension API is designed for human-interactive extensions, not programmatic control by external agents — porting would degrade this advantage.

## Revisit if

- The product pivots to "mcode should also be where users edit code" (even then, embedding Monaco as a standalone npm package is preferred over forking).
- VS Code ships a stable, documented "shell mode" API that allows replacing the editor area with custom content while retaining infrastructure (unlikely).
- A well-maintained, minimal VS Code fork emerges that strips the editor and exposes only the terminal/layout/keybinding infrastructure (does not exist today).
