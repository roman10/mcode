# Gemini CLI Support — Phase 1 Design

## Overview

This document extracts and sharpens the Phase 1 design for Gemini CLI support in mcode.

Phase 1 is the MVP. The objective is to make Gemini sessions behave like supported agent sessions for lifecycle and UI purposes, without taking on hooks, task queue integration, or Gemini-specific product polish.

Phase 1 is complete when Gemini sessions can be:

- created from the UI and MCP tools
- rendered correctly in sidebar, tiles, and kanban
- ended and resumed in place
- tested with deterministic fixtures

## Phase 1 Scope

### In scope

- `SessionType` and app command support for `gemini`
- Gemini session creation through the existing PTY flow
- Gemini label/icon handling
- Gemini resume support backed by persisted Gemini session UUID plus runtime index resolution
- Renderer support for new-session, ended-session resume, and model display compatibility
- MCP/devtools updates
- Unit and integration test coverage

### Out of scope

- Gemini hooks
- Gemini task queue support
- Gemini-specific launch options such as `--model`, `--approval-mode`, `--sandbox`, `--yolo`
- Gemini account-profile isolation
- Cost/token tracking for Gemini

## Verified CLI Constraints

Phase 1 should be designed around the current Gemini CLI behavior, verified locally on `0.35.2`.

- Interactive startup uses positional prompt args: `gemini "prompt"`
- `--prompt` is headless and should not be used for PTY-backed interactive sessions
- Resume uses `--resume <latest|index>`
- `gemini --list-sessions` is project-scoped and prints numbered lines with bracketed UUIDs
- `gemini --list-sessions --output-format json` still emits text, so parsing must be text-based
- Gemini does not currently expose a documented runtime hook registration surface usable by mcode

## Phase 1 Shape

### 1. Shared types and agent metadata

The refactor groundwork for Gemini Phase 1 is already in place.

Completed groundwork:

- `src/shared/constants.ts` already defines `GEMINI_ICON`
- `src/shared/session-agents.ts` already centralizes per-agent metadata such as icon, default command, dialog mode, task-queue support, terminal cursor behavior, account-profile support, and resume identity kind
- renderer label and resume helpers already consume shared agent metadata instead of duplicating some raw Claude/Codex checks

Remaining implementation work:

- extend `SessionType` to include `gemini`
- add `geminiSessionId: string | null` to `SessionInfo`
- extend `AppCommand` new-session union to include `gemini`
- widen renderer/store unions that still only admit `claude | codex`

This keeps Gemini support aligned with the new metadata-driven direction rather than adding another set of ad hoc branches.

### 2. Database and resume identity

Add a migration for persisted Gemini identity:

```sql
ALTER TABLE sessions ADD COLUMN gemini_session_id TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_gemini_session_id
  ON sessions(gemini_session_id)
  WHERE gemini_session_id IS NOT NULL;
```

Important design point:

- `gemini_session_id` is not the runtime resume token
- it is a stable locator used to map back to the current Gemini session index at resume time

This is the right long-term choice as long as Gemini keeps exposing a stable UUID in the session list.

### 3. SessionManager responsibilities

Gemini Phase 1 should keep `SessionManager` as the orchestration layer without letting it absorb Gemini-specific parsing and launch planning.

Current pressure points remain the same:

- `src/main/session/session-manager.ts` already contains creation, resume, persistence mapping, hook event handling, model updates, and cleanup logic
- create/resume logic already has agent-specific branches
- adding Gemini naively would make the class materially harder to reason about and test

The supporting refactors needed to keep this manageable have already landed.

#### 3.1 Gemini list/parse logic already lives in its own file

`src/main/session/gemini-session-store.ts` now exists and already owns:

- parsing numbered Gemini session list output
- choosing the most likely unclaimed session candidate for a newly created session
- resolving a stored Gemini UUID back to the current resume index

What still needs to be wired in Phase 1:

- run `gemini --list-sessions` from the session layer
- feed the output into the existing parser/matcher helpers
- persist the captured Gemini UUID after creation
- use the stored UUID plus current list output during resume

Gemini text parsing should stay in this module rather than moving back into `SessionManager`.

#### 3.2 Spawn-plan helpers are already extracted

`src/main/session/session-launch.ts` already owns the shared create-time helpers for:

- default command resolution
- label construction and prefixing
- create argument construction
- hook-mode selection

The remaining Gemini work is to extend those helpers where needed, primarily for Gemini create arguments and fallback-only hook mode.

#### 3.3 Keep SessionManager as the orchestrator

Do not split `SessionManager` further in Phase 1. The current balance is still correct:

- keep `SessionManager` as the orchestration class
- keep parsing and plan-building in small sibling modules
- wire Gemini through those helpers from `create()` and `resume()`

### 4. Resume design

Phase 1 resume flow should be:

1. create Gemini session in interactive mode
2. poll `gemini --list-sessions` in the session cwd
3. parse entries and persist the unclaimed Gemini UUID for the newly created session
4. when resuming, re-run `gemini --list-sessions`
5. find the entry with the stored UUID
6. spawn `gemini --resume <index>` using the current index

This is clean enough for the long term because it separates:

- stable identity for persistence
- ephemeral index for actual CLI invocation

The design is not clean if we treat Gemini's current numeric index as the persisted identifier. That would be brittle and project-order dependent.

### 5. Renderer design

The renderer already moved part of the way toward metadata-driven agent behavior, but a few type unions and resume checks still need widening.

#### Required Phase 1 updates

- `src/renderer/stores/dialog-store.ts`
- `src/renderer/components/Sidebar/NewSessionDialog.tsx`
- `src/renderer/utils/app-commands.ts`
- `src/renderer/utils/session-resume.ts`
- `src/renderer/utils/label-utils.ts`
- `src/renderer/components/SessionTile/SessionEndedPrompt.tsx`
- `src/renderer/components/SessionTile/ModelPill.tsx`
- `src/renderer/components/SessionTile/TerminalInstance.tsx`

#### Groundwork already completed

- `src/renderer/components/SessionTile/TerminalInstance.tsx` already uses metadata-driven terminal cursor behavior
- `src/renderer/utils/label-utils.ts` already normalizes and splits labels using shared agent metadata
- `src/renderer/components/SessionTile/SessionEndedPrompt.tsx` already delegates resume/new-session decisions through shared resume helpers

Remaining renderer work is mostly type widening plus Gemini visibility in the new-session and ended-session flows.

### 6. MCP and tests

Phase 1 should mirror the Codex testing strategy, with the Gemini parser and label/resume helpers already covered by unit tests from the refactor pass.

Required additions:

- extend `session_create` schema to accept `gemini`
- add Gemini fixture binary/script under `tests/fixtures/gemini`
- add `createGeminiTestSession()` to `tests/helpers.ts`
- add Gemini support and resume suites

Recommended implementation detail:

- update test factories and helper interfaces to include Gemini metadata once, centrally
- add a test-only setter for `geminiSessionId` so resume coverage does not depend on flaky external CLI state
- keep Gemini fixture behavior deterministic and narrow rather than trying to emulate the entire CLI

## Is This Phase 1 Design Clean And Good Long Term?

### Short answer

Yes, with two caveats.

The Phase 1 product scope is clean and appropriate for the long term.
The raw implementation path is not clean if it is done by copying the Codex pattern mechanically into more `sessionType === ...` branches.

### What is good long term

- fallback-only MVP is the right product boundary
- persisted UUID plus runtime index resolution is the right resume strategy
- keeping Gemini out of task queue/hook mode for now is the right architectural call
- mirroring Codex fixture coverage is the right verification strategy

### What is not clean long term

- more hard-coded agent branches in `session-manager.ts`
- more renderer unions like `'claude' | 'codex'`
- more flat per-agent fields added ad hoc without a plan for capability queries

### Recommended judgment

Phase 1 is good long term if the remaining implementation stays on top of the refactor layer that now exists.

## Completed Groundwork

The following refactors are already complete and should be treated as the implementation baseline for Phase 1:

- shared agent metadata in `src/shared/session-agents.ts`
- shared create/launch helpers in `src/main/session/session-launch.ts`
- Gemini list parsing and resume-index helpers in `src/main/session/gemini-session-store.ts`
- metadata-driven renderer resume helpers in `src/renderer/utils/session-resume.ts`
- metadata-driven label handling in `src/renderer/utils/label-utils.ts`

## Remaining Implementation Work

The remaining Phase 1 implementation should proceed in this order:

1. widen shared types, IPC contracts, renderer dialog state, and test helper DTOs to include Gemini
2. add the `gemini_session_id` migration and thread it through `SessionManager` row mapping
3. implement Gemini create-time UUID capture using `gemini --list-sessions` plus the existing parser/matcher helpers
4. implement Gemini in-place resume by resolving the stored UUID back to the current Gemini index
5. extend MCP session tools and integration helpers for Gemini
6. add focused support/resume integration coverage using a deterministic Gemini fixture

Phase 1 is not good long term if implemented as a third copy-pasted agent path inside existing large conditionals.

## Pre-Implementation Refactor Opportunities

These are the refactors worth doing before or at the very start of Phase 1.

### Refactor 1: Shared agent capability registry

Create `src/shared/session-agents.ts` and move agent-level facts there.

Why this is worth it:

- removes repeated default command/icon/form-mode decisions
- avoids future four-way branching when another agent is added
- low risk and small enough to do up front

This should be done before Phase 1 implementation.

### Refactor 2: Extract launch and label helpers from SessionManager

Move command resolution, label prefixing, and per-agent arg building into pure helpers.

Why this is worth it:

- `session-manager.ts` is already oversized
- helper extraction lowers the risk of regressions in Claude/Codex while adding Gemini
- pure helpers are much easier to unit test than the orchestration class

This should be done before or as the first implementation step of Phase 1.

### Refactor 3: Dedicated Gemini session list parser module

Implement Gemini session discovery in `src/main/session/gemini-session-store.ts` rather than inline.

Why this is worth it:

- text parsing logic will evolve independently from PTY orchestration
- resume bugs will be isolated to one module
- makes it easier to add parser-focused unit tests

This should be done as part of Phase 1, but before editing `resume()` heavily.

### Refactor 4: Make resume checks metadata-driven

Current code hard-codes Claude vs Codex in `src/renderer/utils/session-resume.ts` and ended-session UI copy.

Refactor target:

- centralize resume capability and missing-identity messages in one helper

Why this is worth it:

- Gemini otherwise adds more stringly-typed branching
- the ended-state UI becomes easier to reason about

This is worth doing before Phase 1 UI work.

## Refactors To Defer

These are reasonable long-term ideas, but they should not block Phase 1.

### 1. Replace flat per-agent fields with nested agent metadata

Example deferred idea:

```ts
agentState: {
  claude?: { sessionId: string | null }
  codex?: { threadId: string | null }
  gemini?: { sessionId: string | null }
}
```

This is architecturally cleaner, but it touches IPC contracts, renderer assumptions, tests, and database mapping everywhere. Too broad for Phase 1.

### 2. Split SessionManager into repository/runtime/controller classes

That may eventually be worthwhile, but it is a larger architectural project than Gemini Phase 1 needs.

### 3. Generalize all agent-specific UI into pluggable components

That is premature until there is more than one non-Claude minimal-form agent and more UI divergence.

## Recommended Implementation Order

1. Add shared agent metadata module and widen type unions
2. Extract launch/label helpers out of `SessionManager`
3. Add DB migration and Gemini parser/store module
4. Implement Gemini create/resume in `SessionManager`
5. Update renderer helpers and dialog state to consume shared agent metadata
6. Extend MCP tools and tests

## Definition Of Done

Phase 1 is ready to implement if the team agrees on the three small preparatory refactors above.

Phase 1 is complete when:

- Gemini can be created from UI and MCP
- Gemini labels/icons work consistently
- Gemini resume uses stored UUID plus current CLI index resolution
- Gemini remains explicitly fallback-only
- tests cover creation, rendering, and resume behavior