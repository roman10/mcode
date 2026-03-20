# Ephemeral Command Execution — Feasibility & UX Design

**Date:** 2026-03-20
**Status:** Brainstorm — decisions made, not yet implemented

## Context

Users often need to run quick shell commands (`git push`, `npm install`, `make build`) during their workflow. Currently, mcode requires opening a full terminal session for every command, which adds friction for one-off operations. Ephemeral command execution would let users fire-and-forget simple commands with minimal UI disruption.

## Feasibility: High (with minor backend changes)

The existing architecture has most building blocks, with a few gaps to close:

- **`SessionCreateInput`** supports `ephemeral: true` + `sessionType: 'terminal'`, but **`command` field is currently ignored for terminal sessions** — `session-manager.ts` hardcodes `process.env.SHELL` for terminals. Needs a small change to pass `command`/`args` through for terminal sessions.
- **PtyManager** handles spawning and exit detection. **Ring buffer (100KB) is destroyed immediately on PTY exit** (`ptys.delete(id)` in `onExit`), so output must be captured in real-time via `pty:data` in the renderer store — cannot rely on replay.
- **Ephemeral sessions** auto-delete 2s after ending (uncancellable `setTimeout`). Since output is captured renderer-side, deletion of the backend session is acceptable.
- **IPC broadcasting** (`pty:data`, `pty:exit`) already delivers output and exit codes to the renderer with `sessionId`.
- **Ephemeral filtering** in `App.tsx` already skips tile creation and sidebar listing for ephemeral sessions.

**Backend change needed:** Modify `session-manager.ts` `create()` to respect `input.command` and add `input.args` for terminal sessions, instead of hardcoding the user's shell.

## Value Assessment: Strong

| Signal | Reasoning |
|--------|-----------|
| **High frequency** | Git operations, build commands, linting, and test runs are among the most common developer actions |
| **Friction reduction** | Opening a session → running command → closing session is 3 steps for what should be 1 |
| **Context preservation** | Users shouldn't have to rearrange their mosaic layout just to run `git push` |
| **Agentic workflow fit** | Claude sessions often suggest commands the user should run — ephemeral execution is a natural next step |
| **Composability** | MCP devtools could trigger ephemeral commands, enabling automated verification pipelines |

## Stack-Ranked UX Approaches

### Rank 1 (Recommended): Status Bar + Expandable Output Drawer

A thin (24px) status bar at the bottom of the main content area. Running commands appear as pills with a spinner. Clicking a pill slides up a ~200px drawer with live terminal output. Success → green check, auto-fades after 3s. Failure → red pill persists, drawer has "Promote to Full Terminal" / "Retry" / "Copy Output" buttons.

**Triggering:** `!` prefix in command palette (`! git push origin main`), or `Cmd+Shift+E` shortcut. A hint row in the palette shows "Type `!` to run a shell command" for discoverability.

| Criterion | Score | Notes |
|-----------|-------|-------|
| UX quality | 9/10 | Non-disruptive, familiar (VS Code status bar paradigm), works in both tiles + kanban |
| Info density | 9/10 | Progressive disclosure: pill → drawer → full terminal |
| Error handling | 10/10 | Failure persists, output visible, promote/retry/copy actions |
| Impl complexity | Moderate | ~4 new files, reuses session/pty infrastructure entirely |
| Composability | 9/10 | Status bar is reusable for future global indicators; MCP-triggerable |

**Why it wins:** Fills two gaps at once (status bar + ephemeral commands), handles concurrent commands naturally (multiple pills), and works identically in both view modes since it sits outside the mosaic tree.

---

### Rank 2: Headless-First with Toast Notifications

Commands run headless. A small toast appears in bottom-right: spinner while running, green/red on completion. Failure toast has "Show Output" / "Promote" buttons.

| Criterion | Score | Notes |
|-----------|-------|-------|
| UX quality | 8/10 | Maximally non-disruptive for happy path |
| Info density | 5/10 | **Main weakness** — no progress visibility for long commands (npm install, builds) |
| Error handling | 8/10 | Must promote to see output — extra click vs Rank 1 |
| Impl complexity | Low | Toast component (~150 lines) + store |
| Composability | 7/10 | Toast system reusable, but no persistent history; stacks awkwardly past 3-4 |

Good if we want minimal UI investment. Weaker for commands that take >5s where progress feedback matters.

---

### Rank 3: Minimized Tile in Mosaic

Creates a small (~120px) tile showing command name + output. Auto-closes on success. Expands to full terminal on failure.

| Criterion | Score | Notes |
|-----------|-------|-------|
| UX quality | 7/10 | Explicit and visible, but **disrupts layout** — pushes other tiles around |
| Info density | 8/10 | Live output always visible |
| Error handling | 9/10 | Seamless promotion (tile just grows) |
| Impl complexity | Higher | Mosaic has no "preferred size" concept; needs custom tile type; breaks in kanban |
| Composability | 6/10 | Conflicts with balanced tree layout; kanban needs separate code path |

---

### Rank 4: Command Palette Inline Output

Palette stays open after `!` command, list area becomes live output. Close on success, promote on failure.

| Criterion | Score | Notes |
|-----------|-------|-------|
| UX quality | 7/10 | Fast invoke/dismiss, but **blocks the palette** while running |
| Info density | 7/10 | Full output visible, but single-command only |
| Error handling | 7/10 | Output right there, but palette must stay open |
| Impl complexity | Low | Modify CommandPalette.tsx only |
| Composability | 4/10 | Only works through palette; no concurrent commands; no other trigger path |

---

### Rank 5: Sidebar Tab

New "Commands" tab in activity bar showing command list + status. Click to view output in sidebar panel.

| Criterion | Score | Notes |
|-----------|-------|-------|
| UX quality | 6/10 | Requires navigation to sidebar; not keyboard-first |
| Info density | 6/10 | Sidebar is 280px — too narrow for terminal output |
| Error handling | 6/10 | Functional but clunky |
| Impl complexity | Moderate | New sidebar tab + panel component |
| Composability | 5/10 | Heavyweight concept (new top-level tab) for a lightweight feature |

---

### Rank 6: Floating Popup Terminal

Small floating window near bottom-right with live output. Auto-dismiss on success.

| Criterion | Score | Notes |
|-----------|-------|-------|
| UX quality | 6/10 | Can obscure content; window management is fiddly |
| Info density | 7/10 | Live output in reasonable size |
| Error handling | 7/10 | Similar to toast with more output |
| Impl complexity | High | Floating panel management is entirely new paradigm for this app |
| Composability | 3/10 | Floating panels don't integrate with anything existing |

## Sticky Terminal vs Status Bar

### Analysis

These are not different features — they're different **default states** of the same component. The real question is collapse behavior and scope.

| Aspect | Sticky Terminal (always visible) | Status Bar + Drawer (collapse by default) |
|--------|--------------------------------|-------------------------------------------|
| Screen real estate | Permanent cost (~200px) even when idle | Zero cost when idle (24px bar) |
| Output visibility | Always visible — no click needed | Extra click to expand |
| Mental model | Overlaps with terminal tiles — "which terminal do I use?" | Clear purpose: ephemeral commands only |
| Scope creep | Invites tabs, shell history, splits — duplicates terminal tile | Stays focused on fire-and-forget |
| Long-running commands | Natural fit, output always visible | Workable with pin toggle |
| Implementation | More complex (tab management, full panel) | Simpler |

### Decision: Hybrid — Pinnable Status Bar

**Default:** 24px status bar with pills (minimal footprint).
**Expand:** Click pill or drag upward → resizable bottom panel showing terminal output.
**Pin toggle:** Pinned = panel stays open after commands finish (sticky terminal behavior). Unpinned = auto-collapses when all commands complete.

Zero-footprint for casual users, persistent bottom panel for power users, same component. No mental model confusion with terminal tiles because it's clearly a "command runner", not a general-purpose terminal.

**Scope:** Ephemeral (fire-and-forget) commands only — no interactive shell.

### Multi-Repo Considerations

- **CWD resolution:** Focused session's CWD → most recent session's CWD → `$HOME`
- **Repo badge on pills:** Each pill shows repo basename (e.g., `git push` `mcode`, `npm test` `frontend`)
- **CWD picker in `!` mode:** Command palette shows a CWD selector populated from all active session CWDs (deduplicated)
- **Concurrent multi-repo:** Multiple pills naturally represent commands in different repos — the repo badge disambiguates

```
Unpinned (default):
┌─────────────────────────────────┐
│  MosaicLayout / KanbanLayout    │
│                                 │
├─────────────────────────────────┤
│ ● git push (mcode) ✓ npm i (fe)│  ← 24px bar
└─────────────────────────────────┘

Expanded (click pill):
┌─────────────────────────────────┐
│  MosaicLayout / KanbanLayout    │
├─═══════════════════════════════─┤ ← drag handle
│ [git push] [npm i]         📌  │
│ $ git push origin main          │
│ Enumerating objects: 42, done.  │
│ [Promote] [Retry] [Copy]       │
└─────────────────────────────────┘
```

## Key Design Decisions

**Session reuse vs new abstraction:** Reuse existing `session:create` with `ephemeral: true` + `sessionType: 'terminal'`. Requires adding `command`/`args` passthrough for terminal sessions in `session-manager.ts`. The renderer-side `ephemeral-command-store` captures output in real-time via `pty:data` (since ring buffer is destroyed on exit) and tracks command metadata.

**Output lifecycle:** The renderer store accumulates output from `pty:data` events as they arrive. When the session auto-deletes after 2s, the backend data is gone but the renderer store retains the captured output for display. Output is freed when the user dismisses the pill or after a configurable retention (e.g., 50 completed commands).

**"Promote to Full Terminal":** Cannot literally convert a dead/deleted session. Instead: opens a new terminal session at the same CWD. The captured output is not replayed into it — it's a fresh shell for the user to investigate further.

**"Retry":** Re-runs the same command string in the same CWD via a new ephemeral session.

**Relationship to task queue:** Intentionally separate. Task queue dispatches prompts to Claude sessions with quiescence detection. Ephemeral commands are shell invocations with exit-code completion. No shared infrastructure beyond PtyManager.

**Command history:** Last 20 commands persisted in preferences, shown as suggestions in `!` mode.

**Layout integration:** Bottom panel sits below MosaicLayout/KanbanLayout inside the main content flex-col container. Resize handle follows existing pattern from `SidebarPanel.tsx`. Panel height + pinned state persisted in layout-store.

## Implementation Outline

| Phase | What | Files |
|-------|------|-------|
| 1 | Backend: add `command`/`args` passthrough for terminal sessions + add `args` to `SessionCreateInput` | Modify `session-manager.ts`, `types.ts`, `preload/index.ts` |
| 2 | Core execution pipeline (renderer utility + Zustand store with real-time output capture via `pty:data`) | New `ephemeral-command-store.ts`, utility in `session-actions.ts` |
| 3 | Status bar UI (pills with spinner/check/x, auto-fade, repo badge) | New `StatusBar.tsx` |
| 4 | Expandable bottom panel (resizable, pinnable, output display, promote/retry/copy) | New `BottomPanel.tsx` |
| 5 | Command palette `!` mode + CWD picker | Modify `CommandPalette.tsx` |
| 6 | Keyboard shortcut (`Cmd+Shift+E`) + command registry + history | Modify shortcuts + registry |
| 7 | Layout store additions (panel height, pinned, collapsed) + persistence | Modify `layout-store.ts` |

## Verification

- Trigger via command palette `!` mode and `Cmd+Shift+E`
- Run a fast-succeeding command (`echo hello`) → pill appears, shows green check, auto-fades
- Run a slow command (`sleep 5`) → pill spins, click to see panel output, completes
- Run a failing command (`false`) → pill turns red, persists, panel shows output, promote works
- Run multiple concurrent commands → multiple pills in status bar with repo badges
- Pin toggle: pin panel open → commands finish → panel stays. Unpin → auto-collapses.
- Multi-repo: run commands in different session CWDs → pills show correct repo badge
- Resize panel by dragging handle → height persisted across app restart
- MCP devtools: `session_create` with `ephemeral: true` to trigger programmatically
