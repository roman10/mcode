# Gemini CLI Support — Phase 2 Final Status

## Overview

Phase 2 is complete.

The original purpose of Phase 2 was to improve Gemini support without increasing long-term branching cost. That work is now finished:

- the Gemini test fixture is dedicated and no longer piggybacks on Codex
- renderer capability checks use shared runtime helpers
- non-Claude runtime behavior no longer sits inline in the hottest `SessionManager` create and resume paths
- Gemini model selection now flows through the shared `session.model` path
- Gemini resume parser and failure paths have direct unit and integration coverage

This document is the final status record for the completed phase plus the recommended post-Phase-2 boundaries.

## Current Outcome

Phase 1 already shipped the baseline Gemini lifecycle:

- create
- display in existing session surfaces
- kill and delete
- resume in place

Phase 2 completed the maintainability and minimal product-surface work that was intentionally deferred from Phase 1:

- dedicated Gemini integration fixture
- shared runtime capability helpers for renderer logic
- extracted Codex and Gemini runtime adapters in the main process
- deterministic Gemini model support through `--model`
- Gemini resume hardening with parser-level and integration coverage

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

Conclusions that still hold:

- `--model` is the only implementation-ready Gemini launch option candidate from this phase
- parser simplification through `--output-format json` remains blocked on current Gemini CLI behavior

### WP1: Dedicated Gemini Integration Fixture

Completed.

Shipped changes:

- added `tests/fixtures/gemini` as a dedicated fake Gemini CLI
- updated `tests/helpers.ts` so Gemini tests use `tests/fixtures/gemini`
- removed Gemini-specific `--list-sessions` impersonation from `tests/fixtures/codex`
- updated `docs/test/mcp-integration-tests.md` to document the Gemini fixture alongside the Claude and Codex fixtures

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

Claude-only external-session import behavior in `src/renderer/components/Sidebar/SessionList.tsx` remains intentionally out of scope.

### WP3: Non-Claude Session Runtime Adapters In The Main Process

Completed.

Shipped changes:

- added `src/main/session/agent-runtime.ts`
- added `src/main/session/agent-runtimes/codex-runtime.ts`
- added `src/main/session/agent-runtimes/gemini-runtime.ts`
- updated `src/main/session/session-manager.ts` to dispatch Codex and Gemini runtime behavior through adapters

The extracted adapter surface remains intentionally narrow:

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
- Claude create and resume behavior remains inline and unchanged

### WP4: Minimal Gemini Model Option And Model Pill

Completed.

Shipped changes:

- added `model?: string` to the shared `SessionCreateInput`
- exposed the optional Gemini `model` field through `session_create`
- added a small Gemini-only model field in `src/renderer/components/Sidebar/NewSessionDialog.tsx`
- passed Gemini models through `src/main/session/session-launch.ts` as `--model <value>`
- persisted explicit Gemini models through the existing shared `sessions.model` column at create time
- enabled Gemini model rendering by setting `supportsModelDisplay: true` in `src/shared/session-agents.ts`

Behavioral result:

- Gemini now uses the same shared `session.model` display path as the existing model-pill infrastructure
- no runtime Gemini model scraping was added

### WP5: Resume Hardening

Completed.

Shipped changes:

- strengthened parser coverage in `tests/unit/main/gemini-session-store.test.ts`
- added malformed-output and fully-claimed-session coverage for `parseGeminiSessionList(...)` and `selectGeminiSessionCandidate(...)`
- tightened Gemini resume failure assertions in `tests/unit/main/gemini-runtime.test.ts`
- added MCP coverage for the stored-session-ID-missing-from-list resume failure in `tests/suites/gemini-resume.test.ts`
- improved Gemini resume error text so the missing stored session ID is included directly in the failure message

Behavioral result:

- Gemini missing-ID and missing-from-list failures are distinct in both unit and integration coverage
- parser edge cases are covered directly instead of only through higher-level resume tests

## Validation

Focused unit validation passed:

- `npm test -- --run tests/unit/main/session-launch.test.ts tests/unit/shared/session-capabilities.test.ts tests/unit/main/gemini-runtime.test.ts tests/unit/main/gemini-session-store.test.ts`

Focused MCP validation passed against a fresh dev instance:

- `npm run test:mcp -- tests/suites/gemini-support.test.ts tests/suites/gemini-resume.test.ts tests/suites/session-model.test.ts`

## Locked Decisions That Still Hold

These decisions remain correct after the completed implementation:

1. Keep Gemini in fallback mode.
2. Keep `session.model` as the shared persisted model field.
3. Treat `--model` as the only implementation-ready Gemini launch option candidate from this phase.
4. Keep `SessionCreateInput` flat.
5. Keep `SessionManager` as the orchestrator rather than starting a broad rewrite.
6. Keep Claude-only external-session import behavior out of Gemini scope.

## Post-Phase-2 Guidance

Broader Gemini feature expansion should remain a separate follow-up phase.

Still deferred:

- sandbox UI
- approval-mode UI
- yolo UI
- hook-mode support for Gemini
- task queue support for Gemini
- Gemini-specific persistence shapes

If any later phase considers `--sandbox`, `--approval-mode`, or `--yolo`, it should start with a fresh CLI verification pass and an explicit product decision rather than assuming the evidence from Phase 2 is sufficient.

## Definition Of Done

Phase 2 is complete because all of the following are now true:

- Gemini has a dedicated integration fixture
- renderer capability checks use shared runtime helpers instead of open-coded Claude checks
- Codex and Gemini post-create capture and resume preparation no longer live inline in `SessionManager`
- Gemini model selection is wired through a deterministic create-time `--model` path
- Gemini stores the selected model in the existing shared `session.model` field
- Gemini can render the existing `ModelPill` through the shared capability path
- Gemini resume parser and not-found failure modes have direct unit coverage
- Gemini integration tests cover the intended resume failure paths with the dedicated fixture
