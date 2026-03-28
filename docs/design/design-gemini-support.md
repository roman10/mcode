# Gemini CLI Support — Design Document

## Overview

mcode already supports Claude Code, Codex CLI, and plain terminal sessions. This document defines the implementation plan for adding Gemini CLI as another first-class agent session type.

The goal is not full Claude parity on day one. The right MVP is:

- spawn Gemini sessions reliably
- show them correctly across the existing UI
- resume ended Gemini conversations in place
- keep all Gemini sessions in fallback mode until Gemini exposes a stable machine-consumable hook/runtime contract

## Verified CLI Behavior

The design below is based on the locally installed Gemini CLI, not on assumptions.

- Verified against `gemini` version `0.35.2`
- Interactive startup uses positional query args: `gemini "prompt"`
- Headless mode uses `--prompt`, which is not appropriate for mcode's interactive PTY sessions
- Resume uses `--resume <value>` where `<value>` is documented as `latest` or a session index
- `gemini --list-sessions` is project-scoped and prints numbered entries plus a bracketed opaque UUID
- `gemini --list-sessions --output-format json` still prints human-readable text on `0.35.2`, so output parsing must handle text, not JSON
- `gemini hooks --help` currently exposes only `gemini hooks migrate`; there is no documented runtime hook registration surface comparable to Claude's HTTP hooks or Codex's shell-hook bridge

These observations change the original draft in two important ways:

1. Resume cannot be implemented as `gemini --resume <gemini_session_id>`.
2. Hook-based live status/task-queue parity should not be part of the MVP.

## Design Goals

- Agent parity for spawn, display, kill, delete, and resume flows
- Unified UX in sidebar, tiles, kanban, command palette, and MCP tools
- Minimal-risk MVP that reuses the existing PTY/session architecture
- Implementation that preserves room for later Gemini-specific flags and hooks

## Non-Goals For MVP

- Gemini task queue support
- Gemini live hook integration
- Gemini-specific form controls for `--model`, `--approval-mode`, `--sandbox`, or `--yolo`
- Gemini account-profile integration comparable to Claude's HOME isolation

Those can be added later once basic session lifecycle support is stable.

## Feasibility Summary

**Overall: Medium (M) for MVP, Large (L) for eventual parity.**

Gemini is easier than Codex in one respect: it can already spawn interactively with the same PTY flow as Claude and Codex. The main complexity is resume, because Gemini's documented resume API is index-based and project-scoped rather than directly resumable by opaque session ID.

### Integration Breakdown

| Integration Point | Difficulty | Size | Notes |
|---|---|---|---|
| Session spawning | Easy | S | Same PTY infrastructure, positional prompt arg |
| Labeling and icon handling | Easy | S | Same pattern as Codex |
| Resume support | Medium | M | Requires resolving stored Gemini UUID back to current index |
| Renderer session flows | Medium | M | Multiple small Claude/Codex-only unions and branches |
| Model display | Medium | S | Current pill is Claude-only |
| MCP/devtools surface | Easy | S | Extend schemas and descriptions |
| Hook/task queue parity | Hard | L | No documented runtime hook API today |

## Phase Plan

### Phase 1: MVP

- Add `gemini` to shared type unions and session metadata
- Spawn Gemini sessions via `SessionManager.create()`
- Persist Gemini resume identity in the database
- Resume Gemini sessions in place by resolving stored UUID to current Gemini session index
- Update renderer, app commands, and MCP tools to treat Gemini as a supported agent session type
- Add unit and integration coverage mirroring the existing Codex support tests

### Phase 2: Metadata Polish

- Improve Gemini model detection and display
- Consider Gemini-specific launch options in the New Session dialog
- Harden resume matching and failure messages

### Phase 3: Hooks And Tasking

- Re-evaluate if Gemini publishes a stable runtime hook API
- Only then consider task queue, richer status transitions, and live hook mode

## Phase 1 Design

Detailed Phase 1 design now lives in [design-gemini-support-phase1.md](./design-gemini-support-phase1.md).

That document includes:

- the extracted Phase 1 implementation design
- an evaluation of whether the Phase 1 approach is clean enough for the long term
- a short list of refactors worth doing before implementation so Gemini support does not further entrench agent-specific branching

## Open Risks And Decisions

### 1. Resume depends on text parsing

`gemini --list-sessions --output-format json` still emits text on `0.35.2`. That makes the parser more brittle than Codex's SQLite-backed thread discovery. The test fixture should lock this behavior down so format drift is obvious.

### 2. Project scoping matters

Gemini lists sessions "for this project". Resume resolution must run in the original session cwd. If Gemini later scopes sessions differently for nested workspaces or included directories, the matcher may need tightening.

### 3. Stored UUID is a locator, not a resume token

The bracketed Gemini UUID should be stored because it is stable across re-numbering, but the runtime resume command should still use the current list index.

### 4. No live hooks in MVP

Without a documented runtime hook surface, Gemini sessions should stay in fallback mode. That is the correct product behavior for now and avoids inventing unsupported task queue semantics.

## Implementation Checklist

- Add `gemini` to shared unions and session metadata
- Add `GEMINI_ICON`
- Add DB migration for `gemini_session_id`
- Extend `SessionManager.create()` for Gemini spawning
- Add Gemini session capture and resume-index resolution helpers
- Add Gemini branch in `SessionManager.resume()`
- Update renderer unions and conditional branches for Gemini
- Extend MCP session tools and test helpers
- Add Gemini unit tests and integration suites

## Definition Of Done

Gemini support is ready when all of the following are true:

- a Gemini session can be created from the UI and via MCP
- Gemini sessions render correctly in sidebar, tiles, and kanban
- ended Gemini sessions show Resume when `geminiSessionId` is known
- resume reuses the same mcode `sessionId` and tile placement
- the implementation uses `gemini --resume <index>` resolved from stored UUID plus current session list
- all existing tests pass and the new Gemini-specific tests pass
