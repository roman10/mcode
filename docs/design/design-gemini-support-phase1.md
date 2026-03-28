# Gemini CLI Support — Phase 1 Status

## Overview

Phase 1 is implemented.

The original goal was to make Gemini behave like a supported agent session for lifecycle and UI purposes without taking on hooks, task queue parity, account isolation, or Gemini-specific product polish. The current code achieves that goal.

Phase 1 shipped when Gemini sessions became able to:

- be created from the UI and MCP tools
- render correctly in sidebar, tiles, command palette flows, and kanban
- end and resume in place using the same mcode `sessionId`
- stay fallback-only until Gemini exposes a stable runtime hook surface

## Final Scope Delivered

### Delivered

- `SessionType` and session DTOs now include `gemini`
- `AppCommand` supports new Gemini sessions
- Gemini sessions use the existing PTY flow for interactive startup
- Gemini labels and icon handling are wired through the shared agent metadata layer
- Gemini resume is backed by persisted Gemini UUID plus runtime index resolution
- renderer flows support Gemini session creation and ended-session resume
- devtools/MCP surfaces support creating Gemini sessions and setting `geminiSessionId`
- focused unit tests and Gemini-specific integration suites were added

### Intentionally Not Delivered

- Gemini hooks
- Gemini task queue support
- Gemini-specific launch options such as `--model`, `--approval-mode`, `--sandbox`, or `--yolo`
- Gemini account-profile isolation
- Gemini-specific model detection and model display
- Gemini cost/token tracking beyond the existing generic session model field

## What Landed In The Codebase

### 1. Shared metadata and type-system support

The preparatory refactors proposed for Phase 1 were largely the right call and are now part of the baseline architecture.

Implemented:

- `src/shared/constants.ts` defines `GEMINI_ICON`
- `src/shared/types.ts` includes `gemini` in `SessionType`, adds `geminiSessionId`, and widens app-command support
- `src/shared/session-agents.ts` centralizes agent metadata for Claude, Codex, and Gemini

This was the main reason Gemini did not have to be added as a third copy-pasted renderer shape.

### 2. Persistence and resume identity

The database design landed as planned.

Implemented:

- migration `db/migrations/031_gemini_resume.sql`
- nullable `gemini_session_id`
- unique partial index on non-null Gemini session IDs

The persisted Gemini UUID is correctly treated as a stable locator rather than the runtime resume token.

### 3. Main-process session flow

The main process now contains the full Gemini lifecycle path.

Implemented:

- `src/main/session/session-launch.ts` builds Gemini create args using the same shared launch helper layer as other agents
- `src/main/session/gemini-session-store.ts` owns Gemini list parsing, creation-time candidate selection, and resume-index lookup
- `SessionManager.create()` schedules Gemini UUID capture by polling `gemini --list-sessions`
- `SessionManager.resume()` resolves the stored UUID back to the current index and runs `gemini --resume <index>`
- `SessionManager` exposes `setGeminiSessionId()` for test/manual recovery flows

The clean part of this outcome is that Gemini parsing did not get embedded inline in the middle of `SessionManager`.

### 4. Renderer support

Renderer support is functionally complete for Phase 1.

Implemented:

- Gemini is available in the new-session dialog
- Gemini has command-palette support
- label normalization and split-icon handling work for Gemini
- ended-session resume handling is metadata-driven and recognizes Gemini resume identity
- terminal cursor-hiding behavior is metadata-driven and applies to Gemini

One thing Phase 1 deliberately did not solve is Gemini-specific model display. `ModelPill` still only renders for Claude sessions.

### 5. MCP and test support

MCP and tests were extended enough to make Gemini a first-class supported agent path.

Implemented:

- `session_create` accepts `gemini`
- `session_set_gemini_session_id` exists for deterministic testing and manual recovery
- test helpers include `createGeminiTestSession()`
- Gemini support and resume suites exist under `tests/suites/`
- unit tests cover Gemini parser, launch, resume, and label behavior

One notable compromise remains:

- Gemini test helpers currently point at the Codex fixture path instead of a dedicated Gemini fixture

That compromise was acceptable for Phase 1, but it is the first test-maintainability item to fix before Phase 2.

## Verification Status

### Verified in this review pass

- the repository unit test suite passes locally via `npm test`
- total passing result in this pass: 33 files and 433 tests
- Gemini-specific unit coverage is included in that passing run

### Present but not re-verified here

- Gemini support and resume MCP integration suites exist and are wired into the standard integration harness
- they were not re-run successfully in this pass because the required dev MCP server was not reachable on `127.0.0.1:7532`

## Phase 1 Quality Assessment

### What was worth doing

These refactors were high value and proved worth the upfront cost:

- shared agent metadata in `src/shared/session-agents.ts`
- shared launch and label helpers in `src/main/session/session-launch.ts`
- dedicated Gemini session-list parser module in `src/main/session/gemini-session-store.ts`
- metadata-driven resume helpers in `src/renderer/utils/session-resume.ts`
- metadata-driven label handling in `src/renderer/utils/label-utils.ts`

Without those changes, Gemini would have landed as more scattered `claude | codex | gemini` branching.

### What is still rough

Phase 1 is good enough to ship, but these rough edges are still visible:

- `SessionManager` remains the largest concentration of agent-specific orchestration
- renderer capability checks are only partly centralized; several Claude-only affordances still use direct `sessionType === 'claude'` checks
- Gemini integration tests do not yet have a dedicated fixture binary/script

## Risks That Still Matter

### 1. Gemini list parsing is still fragile by nature

The current parser is appropriately isolated, but it is still parsing human-readable output. That remains the correct tradeoff until Gemini exposes reliable machine-readable session data.

### 2. Resume is tightly coupled to cwd-scoped discovery

That coupling is correct given current CLI behavior, but it should stay explicit in future refactors and tests.

### 3. Model support was deferred rather than solved

The model field exists generically on sessions, but Gemini does not yet have a clean capture/display path. Phase 2 should solve that without adding new Gemini-only UI branches in ad hoc places.

## Hand-off To Phase 2

The next step should not be a broad architectural rewrite.

The right Phase 2 is:

- keep the Phase 1 architecture intact
- add only the next small set of refactors that clearly remove future branching pressure
- then layer Gemini model display, verified Gemini launch options, and resume hardening on top

That plan is documented in [design-gemini-support-phase2.md](./design-gemini-support-phase2.md).