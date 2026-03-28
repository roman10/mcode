# Gemini CLI Support — Phase 2 Status And Next Steps

## Overview

Phase 2 is partially complete.

The maintainability work that needed to land before adding more Gemini product surface is now in place:

- WP0 CLI preflight verification is complete
- WP1 dedicated Gemini integration fixture is complete
- WP2 renderer runtime capability helpers are complete
- WP3 non-Claude runtime adapters in the main process are complete

The remaining open work is now product-facing rather than structural:

- WP4 minimal Gemini model option and model pill
- WP5 resume hardening follow-up

This document is therefore no longer a pre-implementation plan for the full phase. It is the current status record plus the recommended next steps.

## Current Outcome

Phase 1 already shipped the Gemini lifecycle that matters for baseline product support:

- create
- display in existing session surfaces
- kill and delete
- resume in place

Phase 2 has now reduced the main maintainability risks that would have made additional Gemini work more expensive:

- Gemini integration tests no longer piggyback on the Codex fixture
- renderer capability checks now go through shared helpers instead of repeated open-coded Claude checks
- Codex and Gemini runtime behavior no longer lives inline inside the hottest `SessionManager` create and resume branches

## Completed Work Packages

### WP0: CLI Preflight Verification

Verified against the currently installed Gemini CLI:

- `gemini` version `0.35.2`

Confirmed behavior:

- `--model`, `--sandbox`, `--approval-mode`, `--yolo`, `--resume`, `--list-sessions`, and `--output-format` are exposed by `gemini --help`
- `gemini -p "..." --model gemini-2.5-pro` is accepted on a real invocation path
- `gemini -p "..." --sandbox` is accepted on a real invocation path
- `gemini -p "..." --approval-mode plan` is accepted on a real invocation path
- `gemini --list-sessions --output-format json` still emits human-readable output rather than usable JSON

Consequences that still hold:

- `--model` remains the only implementation-ready Gemini launch option candidate
- parser simplification through `--output-format json` remains blocked on current Gemini CLI behavior

### WP1: Dedicated Gemini Integration Fixture

Completed.

Shipped changes:

- added `tests/fixtures/gemini` as a dedicated fake Gemini CLI
- updated `tests/helpers.ts` so Gemini tests use `tests/fixtures/gemini` instead of the Codex fixture path
- removed the Gemini-specific `--list-sessions` impersonation from `tests/fixtures/codex`
- updated `docs/test/mcp-integration-tests.md` to document the Gemini fixture alongside the Claude and Codex fixtures

Current fixture behavior:

- plain invocation prints a deterministic ready marker and argv echo for create-path assertions
- `--list-sessions` returns stable Gemini-format session data for capture and resume resolution
- resume is exercised through the dedicated Gemini path instead of a Codex surrogate

### WP2: Runtime Capability Helpers For Renderer Cleanup

Completed.

Shipped changes:

- added `src/shared/session-capabilities.ts`
- extended `src/shared/session-agents.ts` with stable metadata used by runtime helpers:
  - `supportsModelDisplay`
  - `installHelpUrl`

Shared runtime helpers now cover:

- `canSessionQueueTasks(...)`
- `canSessionBeTaskTarget(...)`
- `canSessionBeDefaultTaskTarget(...)`
- `canDisplaySessionModel(...)`
- `getSessionInstallHelp(...)`

Call sites moved onto the shared helpers:

- `src/renderer/App.tsx`
- `src/renderer/components/shared/CreateTaskDialog.tsx`
- `src/renderer/components/SessionTile/TerminalTile.tsx`
- `src/renderer/components/SessionTile/TerminalToolbar.tsx`
- `src/renderer/components/SessionTile/SessionEndedPrompt.tsx`
- `src/renderer/components/SessionTile/ModelPill.tsx`

Scope intentionally unchanged:

- Claude-only external-session import behavior in `src/renderer/components/Sidebar/SessionList.tsx` remains out of scope

### WP3: Non-Claude Session Runtime Adapters In The Main Process

Completed.

Shipped changes:

- added `src/main/session/agent-runtime.ts`
- added `src/main/session/agent-runtimes/codex-runtime.ts`
- added `src/main/session/agent-runtimes/gemini-runtime.ts`
- updated `src/main/session/session-manager.ts` to dispatch Codex and Gemini runtime behavior through adapters

The extracted adapter surface is intentionally narrow:

- `afterCreate(...)`
- `prepareResume(...)`

Behavior now delegated out of `SessionManager`:

- Codex post-create thread capture scheduling
- Gemini post-create session ID capture scheduling
- Codex resume preparation
- Gemini resume preparation

What did not change:

- `SessionManager` still owns orchestration
- shared create-argument planning stays in `src/main/session/session-launch.ts`
- Claude create/resume behavior remains inline and unchanged

## Added Test Coverage

The refactor shipped with focused unit coverage for the new seams:

- `tests/unit/shared/session-capabilities.test.ts`
- `tests/unit/main/codex-runtime.test.ts`
- `tests/unit/main/gemini-runtime.test.ts`

Those tests cover:

- task-target and model-display capability gating
- install-help lookup behavior
- Codex adapter create/resume planning
- Gemini adapter create/resume planning
- clearer Gemini missing-session error paths at the adapter layer

## Remaining Work

### WP4: Minimal Gemini Model Option And Model Pill

Not started.

Current state:

- Gemini still does not persist a create-time model value through the shared `session.model` field
- `src/shared/session-agents.ts` still sets `supportsModelDisplay: false` for Gemini
- `ModelPill` is now capability-driven, but Gemini remains intentionally disabled because there is no deterministic create-time model path wired through the product yet

This is now the highest-value remaining item.

### WP5: Resume Hardening

Partially improved, but not complete as a work package.

What already improved as part of WP3:

- Gemini resume preparation now emits clearer missing-ID and missing-session errors
- Gemini resume log context now includes the stored session ID, cwd, and resolved resume index when available

What is still open:

- parser-level malformed-output coverage in `gemini-session-store`
- dedicated unit coverage for malformed or ambiguous `--list-sessions` output
- explicit integration coverage for additional resume mismatch scenarios beyond the existing missing-ID and happy-path cases
- any decision about whether further log enrichment needs to be surfaced through devtools responses

## Locked Decisions That Still Hold

These earlier decisions are still correct after the completed refactor:

1. Keep Gemini in fallback mode.
2. Keep `session.model` as the shared persisted model field.
3. Treat `--model` as the only implementation-ready Gemini launch option candidate.
4. Keep `SessionCreateInput` flat.
5. Keep `SessionManager` as the orchestrator rather than starting a broad rewrite.
6. Keep Claude-only external-session import behavior out of Gemini Phase 2 scope.

## Recommended Next Steps

### 1. Implement WP4 next

Recommended scope:

- add a minimal optional Gemini model field to session creation
- pass it through `src/main/session/session-launch.ts` as `--model <value>` for Gemini only
- persist it into the existing shared `session.model` field at create time
- flip Gemini to `supportsModelDisplay: true` only after the full create-to-render path is wired and tested
- extend the Gemini fixture only as much as needed to make model assertions deterministic

Why this should go next:

- it turns the verified `--model` CLI support into an actual product capability
- the new capability helpers already make the renderer-side display logic low-risk
- the runtime extraction already removed the most expensive `SessionManager` branching pressure

### 2. Finish the remaining WP5 hardening after WP4

Recommended scope:

- add `tests/unit/main/gemini-session-store.test.ts`
- cover malformed `--list-sessions` output and not-found resolution cases directly at the parser/store layer
- add one more integration path for stored-session mismatch against the dedicated Gemini fixture if the current suites do not already make that failure mode explicit enough

Why this comes second:

- the user-facing value is lower than deterministic model support
- the most important resume-path structure is already in place
- this work is easier to scope correctly once the remaining Gemini product surface is settled

### 3. Do not start broader Phase 2 feature expansion yet

Still defer:

- sandbox UI
- approval-mode UI
- yolo UI
- hook-mode support for Gemini
- task queue support for Gemini
- Gemini-specific persistence shapes

None of those are justified by the current verification or by the remaining maintainability risks.

## Definition Of Done For The Remaining Phase 2 Work

Phase 2 should now be considered fully complete when all of the following are true:

- Gemini model selection is wired through a deterministic create-time `--model` path
- Gemini stores the selected model in the existing shared `session.model` field
- Gemini can render the existing `ModelPill` through the shared capability path
- Gemini resume parser and not-found failure modes have direct unit coverage
- Gemini integration tests cover the remaining intended resume failure paths with the dedicated fixture