# Gemini CLI Support — Status And Forward Plan

## Overview

Gemini CLI support is now implemented in mcode as a Phase 1 agent integration.

The shipped Phase 1 behavior is intentionally narrower than Claude support:

- Gemini sessions can be created from UI and MCP
- Gemini sessions render as agent sessions across the existing session surfaces
- ended Gemini sessions can be resumed in place
- Gemini remains fallback-only because Gemini still does not expose a stable runtime hook surface that mcode can rely on

This document now serves two purposes:

- record what Phase 1 actually delivered
- define the boundary between finished Phase 1 work and the next clean Phase 2 work

Detailed Phase 1 implementation status lives in [design-gemini-support-phase1.md](./design-gemini-support-phase1.md).
The proposed Phase 2 plan lives in [design-gemini-support-phase2.md](./design-gemini-support-phase2.md).

## Verified CLI Constraints

The implementation is still based on the verified Gemini CLI behavior from `0.35.2`.

- Interactive startup uses positional prompt args: `gemini "prompt"`
- `--prompt` is headless and is not used for PTY-backed interactive sessions
- Resume uses `--resume <latest|index>`
- `gemini --list-sessions` is project-scoped and prints numbered entries with bracketed UUIDs
- `gemini --list-sessions --output-format json` still emits human-readable text, so parsing remains text-based
- `gemini hooks --help` still does not expose a runtime hook registration surface usable by mcode

Two design consequences are unchanged:

1. Resume must resolve a stored Gemini UUID back to the current list index.
2. Live hook mode and task-queue parity remain explicitly out of scope.

## Current Implementation Status

### Shipped in Phase 1

- shared types now include `gemini` as a first-class `SessionType`
- session records persist `geminiSessionId` and the database has a dedicated `gemini_session_id` migration and unique index
- shared agent metadata exists in `src/shared/session-agents.ts` and covers Gemini icon, default command, dialog mode, resume identity kind, account-profile support, and terminal cursor behavior
- shared create/launch helpers in `src/main/session/session-launch.ts` handle Gemini label prefixing, default command resolution, and create args
- Gemini session-list parsing and resume-index lookup live in `src/main/session/gemini-session-store.ts`
- `SessionManager.create()` spawns Gemini sessions and schedules post-spawn UUID capture by polling `gemini --list-sessions`
- `SessionManager.resume()` resolves the stored Gemini UUID back to the current Gemini index and resumes with `gemini --resume <index>`
- renderer flows now treat Gemini as an agent session in the new-session dialog, command palette, label handling, resume handling, sidebar visibility, tiles, and kanban
- devtools/MCP session tools accept `gemini` and expose a test/manual recovery setter for `geminiSessionId`
- unit coverage exists for the Gemini parser, launch helpers, resume helpers, label handling, and app-command wiring
- integration suites exist for Gemini support and Gemini resume

### Explicitly Deferred

- Gemini live hooks
- Gemini task queue support
- Gemini account-profile isolation comparable to Claude
- Gemini-specific launch options such as `--model`, `--sandbox`, or approval-related flags
- Gemini-specific model detection and model-pill display

### Partially Clean But Not Finished

The Phase 1 preparatory refactors were worth doing and are now in place, but the codebase still has a few remaining areas where Phase 2 could easily add more branching if left alone:

- `SessionManager` still owns agent-specific create/resume orchestration for Claude, Codex, and Gemini
- some renderer capability checks are still Claude-specific rather than driven by a single capability query
- Gemini integration tests currently reuse the Codex fixture path instead of a dedicated Gemini fixture

## Verification Status

The current tree is in a good state for the shipped Phase 1 scope.

- `npm test` passes locally: 33 files, 433 tests
- Gemini-specific unit tests are included in that passing run
- Gemini MCP integration suites exist and are wired into `tests/suites/gemini-support.test.ts` and `tests/suites/gemini-resume.test.ts`

One verification gap remains in this review pass:

- the Gemini MCP suites were not re-run to completion here because the required dev MCP server was not reachable on `http://127.0.0.1:7532/mcp`

That is an environment limitation, not evidence that the Gemini integration is incomplete.

## Open Risks And Decisions

### 1. Resume still depends on text parsing

`gemini --list-sessions --output-format json` still does not give reliable machine-readable output on `0.35.2`, so the parser remains intentionally text-based. That is acceptable for Phase 1, but the implementation should continue to keep all Gemini list parsing isolated in one module.

### 2. Project scoping is part of the contract

Gemini session discovery is cwd-sensitive. Resume resolution must continue to run in the session's original cwd, and any future Phase 2 hardening should preserve that assumption.

### 3. The stored UUID is a locator, not the runtime token

This design choice remains correct. The persisted Gemini UUID is the stable identity; the runtime resume argument is still the current Gemini index.

### 4. The current test fixture shape is serviceable but not ideal

Gemini integration helpers currently reuse the Codex fixture path. That was sufficient to land Phase 1 coverage, but it hides Gemini-specific behavior and should be corrected before Phase 2 adds launch-option and model-related coverage.

## Recommendation For Phase 2

Phase 2 should stay narrow and maintainability-focused.

The right next step is not hooks or task queues. The right next step is:

- introduce only the refactors that clearly reduce future agent branching
- then add Gemini model display, verified Gemini launch options, and better resume failure handling on top of those refactors

The concrete Phase 2 proposal is documented in [design-gemini-support-phase2.md](./design-gemini-support-phase2.md).
