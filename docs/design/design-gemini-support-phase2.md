# Gemini CLI Support — Phase 2 Implementation Plan

## Overview

Phase 2 should stay narrow.

Phase 1 already shipped the Gemini lifecycle that actually matters for basic product support:

- create
- display in existing session surfaces
- kill and delete
- resume in place

The job of Phase 2 is to improve Gemini support without increasing long-term branching cost.

This document is implementation-ready. It reflects a review of the current codebase and locks the decisions that matter before coding starts.

## Review Outcome

The original Phase 2 direction was mostly right, but two parts needed tightening before implementation:

### 1. The lifecycle-adapter proposal was too broad

`src/main/session/session-launch.ts` already owns shared create-argument planning. A new adapter layer should not duplicate that work.

Phase 2 should extract only the parts that are still causing agent-specific sprawl inside `SessionManager`:

- post-create identity capture
- resume preparation
- resume-specific diagnostics

It should not replace the existing launch helpers.

### 2. Static metadata alone is not enough for renderer cleanup

Several renderer checks are not just about agent type. They depend on runtime session state such as:

- `hookMode`
- `status`
- `exitCode`

So the correct abstraction is:

- static agent metadata in `src/shared/session-agents.ts`
- small runtime capability helpers that combine metadata with current session state

Expanding metadata alone would not remove the current duplication.

### 3. The dedicated Gemini fixture is mandatory before feature work

The current Gemini integration tests still use the Codex fixture path through `TEST_GEMINI_PATH = TEST_CODEX_PATH` in `tests/helpers.ts`.

That was acceptable for Phase 1 resume coverage, but it is not a good base for:

- Gemini-specific launch options
- Gemini model handling
- tighter resume diagnostics

This is the first implementation step, not a cleanup item for later.

## Locked Decisions

These decisions should be treated as fixed for Phase 2 unless a new CLI verification result forces a change.

### 1. Keep Gemini in fallback mode

Phase 2 does not add hooks or task-queue support.

### 2. Keep `session.model` as the shared persisted model field

Do not add Gemini-only model storage.

### 3. Do not start with automatic Gemini model scraping

Phase 2 should prefer explicit, deterministic model capture.

The default implementation path is:

- add a verified Gemini `--model` launch option if the CLI supports it as expected
- persist that value into the existing `model` field at create time
- render the pill from the existing `session.model`

Only add runtime Gemini model inference if CLI verification finds a stable source that is easy to test.

### 3a. Phase 2 should only commit to `--model`

WP0 confirmed that Gemini CLI `0.35.2` exposes and accepts these flags on real invocation paths:

- `--model`
- `--sandbox`
- `--approval-mode`
- `--yolo`
- `--resume`
- `--list-sessions`
- `--output-format`

But only `--model` is a clear Phase 2 candidate.

Why the others stay out of the implementation-ready scope for now:

- `--sandbox`, `--approval-mode`, and `--yolo` were accepted by the CLI parser, but this verification pass did not establish product semantics that mcode should expose in the UI
- Phase 2 does not add tasking, hooks, or Gemini-specific permission workflow, so those flags would add surface area faster than they add value

As a result, the implementation-ready Phase 2 scope should treat `--model` as the only launch option candidate unless a later product decision explicitly expands that scope.

### 4. Keep `SessionCreateInput` flat

Do not introduce a generic `launchOptions` map or nested per-agent input object.

If Gemini launch options are added, add only the minimal explicit fields needed for the verified Phase 2 scope.

### 5. Do not start with a full `SessionManager` rewrite

Phase 2 may extract small runtime helpers or adapters, but `SessionManager` remains the orchestrator.

### 6. Leave Claude-only external-session import alone

`src/renderer/components/Sidebar/SessionList.tsx` has Claude-only external import behavior. That is not a Gemini Phase 2 target and should stay out of scope.

## Phase 2 Goals

- replace the Gemini test-fixture compromise with a dedicated Gemini fixture
- reduce the highest-value agent-specific branching that remains in `SessionManager` and renderer runtime checks
- support a minimal verified Gemini model option and model display path
- improve Gemini resume errors and diagnostics

## Phase 2 Non-Goals

- Gemini live hook support
- Gemini task queue support
- Gemini account-profile isolation comparable to Claude
- nested per-agent persistence state
- a full repository/runtime/controller split for `SessionManager`
- a plugin architecture for agent-specific UI
- speculative Gemini flags that have not been re-verified against the actual CLI

## Work Packages

Implementation should follow these work packages in order.

### WP0: CLI Preflight Verification

#### Goal

Re-verify the exact Gemini CLI behavior Phase 2 depends on before editing product code.

#### Questions to verify

- whether `gemini --model <value>` is supported for interactive PTY sessions
- whether any Gemini approval or sandbox flag is both stable and relevant for mcode
- whether Gemini emits any stable, machine-readable model signal during startup or resume

#### Output

- update the Phase 2 doc if the verified flags differ from the current assumption
- do not begin product-code changes until this verification is done

#### Notes

If `--model` is not verified cleanly, Phase 2 should skip launch-option work and keep model display deferred.

#### Verification result

WP0 is complete for the currently installed Gemini CLI.

Verified against:

- `gemini` version `0.35.2`

Observed behavior:

- `gemini --help` advertises `--model`, `--prompt`, `--prompt-interactive`, `--sandbox`, `--yolo`, `--approval-mode`, `--resume`, `--list-sessions`, and `--output-format`
- `gemini --list-sessions --output-format json` still prints human-readable text rather than machine-readable JSON
- `gemini -p "..." --model gemini-2.5-pro` is accepted as a real invocation path and reaches request execution
- `gemini -p "..." --sandbox` is accepted as a real invocation path and reaches request execution
- `gemini -p "..." --approval-mode plan` is accepted as a real invocation path and reaches Gemini startup before cancellation

Caveats from this verification pass:

- the live invocations hit account and quota limits, so this pass verifies flag acceptance, not successful task completion
- this pass did not establish that sandbox or approval-related options are product-worthy for mcode Phase 2

Phase 2 consequence:

- continue treating `--model` as the only implementation-ready Gemini launch option candidate
- continue treating `--list-sessions --output-format json` as unusable for parser simplification on `0.35.2`

### WP1: Dedicated Gemini Integration Fixture

#### Goal

Replace the current Gemini-to-Codex fixture reuse with a real Gemini fixture.

#### Files

- `tests/fixtures/gemini`
- `tests/helpers.ts`
- `tests/suites/gemini-support.test.ts`
- `tests/suites/gemini-resume.test.ts`
- `docs/test/mcp-integration-tests.md`

#### Required behavior

The fixture must support only what Gemini Phase 2 actually needs:

- interactive startup with positional prompt args
- `--list-sessions`
- `--resume <index>`
- deterministic session IDs for capture and resume assertions
- optional explicit model echo only if WP0 verifies a stable Phase 2 model path

#### Fixture structure

The fixture should be a shell script at `tests/fixtures/gemini`, following the same pattern as the existing codex fixture:

- on plain invocation: print a ready marker, echo argv, then sleep (supports create + capture tests)
- on `--list-sessions`: print a canned session list with known IDs in the format `parseGeminiSessionList` expects (e.g., `1. Test Session (just now) [gemini-fixture-session-001]`)
- on `--resume <index>`: echo a resume marker with the index and exit (supports resume assertions)
- on `--model <value>`: echo the model value (only if WP0 verifies `--model` support)

Session IDs in the canned list must be stable string literals so tests can assert on exact capture and resume-index resolution.

#### Codex fixture cleanup

The codex fixture (`tests/fixtures/codex`) currently contains a Gemini-format `--list-sessions` handler (line 4: `fake gemini session`) because `TEST_GEMINI_PATH` aliased to it. When the dedicated Gemini fixture is created, remove the `--list-sessions` handler from the codex fixture unless Codex tests depend on it independently.

#### Acceptance criteria

- `tests/helpers.ts` no longer aliases Gemini to the Codex fixture
- Gemini support and resume suites pass against the dedicated fixture
- the codex fixture no longer contains Gemini-specific `--list-sessions` output
- the MCP integration-test doc mentions the Gemini fixture alongside the existing Claude and Codex fixtures

### WP2: Runtime Capability Helpers For Renderer Cleanup

#### Goal

Replace the highest-value direct Claude checks with shared runtime helper functions.

#### Why this is worth doing

These files currently hard-code Claude behavior in ways that will otherwise get worse when Gemini model display and launch options are added:

- `src/renderer/App.tsx`
- `src/renderer/components/shared/CreateTaskDialog.tsx`
- `src/renderer/components/SessionTile/TerminalTile.tsx`
- `src/renderer/components/SessionTile/TerminalToolbar.tsx`
- `src/renderer/components/SessionTile/SessionEndedPrompt.tsx`
- `src/renderer/components/SessionTile/ModelPill.tsx`

#### Proposed shape

Keep `src/shared/session-agents.ts` for static metadata.

Add a small helper module for runtime capability checks, for example:

- `src/shared/session-capabilities.ts`

Suggested helpers:

```ts
// Gates task-creation affordances in tiles and pre-selects dialog defaults.
// Predicate: agent supports task queue AND hookMode === 'live' AND status !== 'ended'
// Used by: TerminalTile (Shift+Q), TerminalToolbar (New Task button), App.tsx (dialog defaults)
canSessionQueueTasks(session: Pick<SessionInfo, 'sessionType' | 'hookMode' | 'status'> | undefined): boolean

// Filters sessions that are valid targets inside CreateTaskDialog's session list.
// Predicate: agent supports task queue AND hookMode === 'live' AND status in ('active', 'idle')
// Stricter than canSessionQueueTasks — excludes 'starting' and other transient states.
canSessionBeDefaultTaskTarget(session: Pick<SessionInfo, 'sessionType' | 'hookMode' | 'status'> | undefined): boolean

canDisplaySessionModel(session: Pick<SessionInfo, 'sessionType' | 'model'> | undefined): boolean
getSessionInstallHelp(sessionType: SessionType | undefined): { command: string; url: string } | null
```

#### Static metadata additions worth making

These are worth adding to `src/shared/session-agents.ts` because they are stable agent facts:

- `supportsModelDisplay`
- `installHelpUrl`

Do not add task-queue-only metadata without runtime wrappers, because task-queue availability also depends on hook mode and session status.

#### Acceptance criteria

- the listed renderer files use shared runtime capability helpers instead of open-coded Claude checks for tasking, model display, and install-help decisions
- Claude-only external-session import logic in `SessionList.tsx` remains unchanged and explicitly out of scope
- new helper behavior has focused unit coverage

### WP3: Non-Claude Session Runtime Adapters In The Main Process

#### Goal

Reduce the highest-value `SessionManager` branching without rewriting the whole class.

#### Why this is worth doing

The main remaining Gemini maintainability problem is in `src/main/session/session-manager.ts`, specifically:

- post-create capture scheduling
- non-Claude resume preparation
- non-Claude resume diagnostics

Claude create and resume behavior is materially more complex because of accounts and hooks. Phase 2 should not try to normalize that path yet.

#### Scope

Extract runtime behavior for Codex and Gemini only.

Keep these existing responsibilities where they are:

- DB writes
- PTY spawning
- status updates
- renderer broadcast
- shared create-arg planning in `src/main/session/session-launch.ts`

#### Proposed files

- `src/main/session/agent-runtime.ts`
- `src/main/session/agent-runtimes/codex-runtime.ts`
- `src/main/session/agent-runtimes/gemini-runtime.ts`
- `src/main/session/session-manager.ts`

#### Proposed interface

Keep the interface narrow. For example:

```ts
interface AgentRuntimeAdapter {
  sessionType: 'codex' | 'gemini';
  afterCreate?(ctx: PostCreateContext): void;
  prepareResume(ctx: ResumeContext): PreparedResume;
}
```

Where `PreparedResume` contains only what `SessionManager` needs to finish the job, such as:

- command
- cwd
- args
- hookMode
- log context

#### Adapter dispatch

`SessionManager` should hold a `Map<SessionType, AgentRuntimeAdapter>` populated at construction time with entries for `codex` and `gemini`. In the create and resume paths, `SessionManager` looks up the adapter for the session's type. When an adapter exists, it delegates post-create and resume-preparation to it. When no adapter is registered (Claude, terminal), the existing inline logic runs unchanged.

#### Exact code to move

- Codex thread-capture scheduling logic out of the create path
- Gemini session-ID capture scheduling logic out of the create path
- Codex resume-preparation logic out of the resume path
- Gemini resume-preparation logic out of the resume path

#### Acceptance criteria

- `SessionManager.create()` no longer contains direct `if (isCodex)` or `if (isGemini)` post-create scheduling branches
- `SessionManager.resume()` no longer contains the inline Codex and Gemini resume-preparation blocks
- create and resume behavior for Codex and Gemini remains unchanged
- unit tests cover the new adapter behavior where practical

### WP4: Minimal Gemini Model Option And Model Pill

#### Goal

Support a deterministic Gemini model display path with the least risky implementation.

#### Default implementation path

If WP0 verifies `--model`, implement Phase 2 model support this way:

1. add an optional explicit model field for session creation
2. pass it through to Gemini create args
3. persist it into `sessions.model` at create time
4. display it with the existing session model pill for Gemini sessions

This avoids relying on unstable runtime scraping.

#### Files

- `src/shared/types.ts`
- `src/devtools/tools/session-tools.ts`
- `src/renderer/components/Sidebar/NewSessionDialog.tsx`
- `src/main/session/session-launch.ts`
- `src/main/session/session-manager.ts`
- `src/renderer/components/SessionTile/ModelPill.tsx`
- `tests/unit/main/session-launch.test.ts`
- `tests/unit/renderer/utils/app-commands-new-session.test.ts` only if dialog behavior changes there
- `tests/suites/gemini-support.test.ts`
- `tests/suites/session-model.test.ts`

#### Input-shape rule

Add the smallest explicit field that matches the verified CLI behavior.

Example only if verified:

```ts
model?: string
```

Do not add a generic option bag.

#### UI rule

Keep Gemini on the existing minimal dialog.

If a model selector is added, it should be a small conditional field shown only for Gemini, not a separate Gemini-specific complex form.

#### Acceptance criteria

- creating a Gemini session with an explicit model persists `session.model`
- `ModelPill` renders for Gemini when `session.model` is present
- no automatic Gemini model scraping is added unless WP0 found a stable source and the fixture can reproduce it

### WP5: Resume Hardening

#### Goal

Improve the operator and user experience when Gemini resume resolution fails.

#### Files

- `src/main/session/gemini-session-store.ts`
- `src/main/session/session-manager.ts`
- `src/devtools/tools/session-tools.ts` only if debug metadata is added to responses
- `tests/unit/main/gemini-session-store.test.ts`
- `tests/suites/gemini-resume.test.ts`

#### Improvements to make

- clearer error text when no Gemini session ID is recorded
- clearer error text when the stored Gemini session ID is missing from the current Gemini session list
- include cwd and stored session ID in logs for capture and resume mismatches
- add tests for malformed list output and missing-session cases

#### Acceptance criteria

- Gemini resume failure modes are distinguishable in tests and logs
- parser-level tests cover malformed output and not-found cases
- the integration suite covers the missing-session-ID and resume-success paths with the dedicated Gemini fixture

## Implementation Order

Use this order exactly.

1. WP0 CLI preflight verification
2. WP1 dedicated Gemini fixture
3. WP2 runtime capability helpers
4. WP3 non-Claude runtime adapters
5. WP4 minimal Gemini model option and model pill
6. WP5 resume hardening

This order minimizes rework:

- the fixture lands before behavior-specific tests
- renderer cleanup lands before new Gemini UI surface
- main-process branching reduction lands before adding more Gemini behavior there

## Test Plan

At minimum, Phase 2 should end with:

- `npm test`
- `npm run test:mcp -- tests/suites/gemini-support.test.ts tests/suites/gemini-resume.test.ts`

If model support lands through the shared session model path, also run:

- `npm run test:mcp -- tests/suites/session-model.test.ts`

Recommended new unit coverage:

- runtime capability helpers
- non-Claude runtime adapters
- Gemini launch-arg construction if a model option is added
- Gemini parser edge cases for malformed or missing session-list entries

## Definition Of Done

Phase 2 is complete when all of the following are true:

- Gemini has a dedicated integration fixture
- the remaining high-value renderer capability checks use shared runtime helpers instead of open-coded Claude checks
- Codex and Gemini post-create capture and resume preparation no longer live inline in `SessionManager`
- Gemini model display works through the existing `session.model` field using a deterministic input path
- Gemini launch options are limited to a verified minimal subset
- Gemini resume errors are clearer and covered by both unit and integration tests