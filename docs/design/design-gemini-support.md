# Gemini CLI Support — Status And Forward Plan

## Overview

Gemini CLI support in mcode has progressed through three phases of work:

- **Phase 1** shipped the baseline Gemini lifecycle: create, display, kill, resume
- **Phase 2** completed maintainability refactors: dedicated fixture, shared capability helpers, agent runtime adapters, `--model` support, resume hardening
- **Post-Phase 2** landed hook-based state tracking: Gemini sessions now operate `hookMode='live'` when the bridge is ready, matching the architecture Claude and Codex use

SessionManager delegates all agent-specific logic to runtime adapters. Gemini is a first-class adapter alongside Claude and Codex with no special-case branching in the orchestrator.

This document serves three purposes:

- record what each phase delivered
- define the remaining gap list
- propose Phase 3 scope

Detailed Phase 1 implementation status lives in [design-gemini-support-phase1.md](./design-gemini-support-phase1.md).
Phase 2 final status lives in [design-gemini-support-phase2.md](./design-gemini-support-phase2.md).
The Phase 3 design lives in [design-gemini-support-phase3.md](./design-gemini-support-phase3.md).

## Verified CLI Constraints

The implementation is based on verified Gemini CLI behavior from `0.35.2`.

- Interactive startup uses positional prompt args: `gemini "prompt"`
- `--prompt` is headless and is not used for PTY-backed interactive sessions
- Resume uses `--resume <latest|index>`
- `gemini --list-sessions` is project-scoped and prints numbered entries with bracketed UUIDs
- `gemini --list-sessions --output-format json` still emits human-readable text, so parsing remains text-based
- Hook registration works via `~/.gemini/settings.json` hook entries managed by mcode at startup and cleaned up on quit

Two design consequences remain:

1. Resume must resolve a stored Gemini UUID back to the current list index via text parsing.
2. Task-queue parity remains explicitly out of scope (`supportsTaskQueue: false` in agent metadata).

## Architecture

The Gemini integration follows the shared agent runtime adapter pattern.

### Agent Runtime Adapters

- Interface defined in `src/main/session/agent-runtime.ts` with four optional hooks: `prepareCreate`, `afterCreate`, `prepareResume`, `pollState`
- Per-agent adapter implementations in `src/main/session/agent-runtimes/`:
  - `claude-runtime.ts` — full-featured (worktree, permission mode, effort, user-choice detection)
  - `codex-runtime.ts` — minimal (thread capture, resume, quiescence polling)
  - `gemini-runtime.ts` — minimal (session ID capture, index-based resume, quiescence polling)
- `SessionManager` is a pure orchestrator: create, resume, and pollSessionStates dispatch to adapters with no agent-specific branching

### Hook Integration

- Per-agent hook config files in `src/main/hooks/`:
  - `hook-config.ts` (Claude) — manages `~/.claude/settings.json`
  - `codex-hook-config.ts` — manages Codex hook registration
  - `gemini-hook-config.ts` — manages `~/.gemini/settings.json`
- Gemini registers 7 bridge events: `SessionStart`, `SessionEnd`, `BeforeTool`, `AfterTool`, `AfterAgent`, `BeforeAgent`, `Notification`
- Bridge script at `~/.mcode/gemini-hook-bridge.sh` forwards events to mcode's HTTP hook server when `MCODE_HOOK_PORT` is set; exits silently for non-mcode sessions
- Event name normalization in `src/main/hooks/hook-server.ts` maps Gemini native names to mcode canonical names:
  - `BeforeTool` -> `PreToolUse`, `AfterTool` -> `PostToolUse`, `AfterAgent` -> `Stop`, `BeforeAgent` -> `UserPromptSubmit`
  - `SessionStart`, `SessionEnd`, `Notification` pass through unchanged

### Shared Capability System

- Agent metadata in `src/shared/session-agents.ts` (`AgentDefinition` records per agent type)
- Shared capability queries in `src/shared/session-capabilities.ts`:
  - `canSessionQueueTasks(...)`, `canSessionBeTaskTarget(...)`, `canSessionBeDefaultTaskTarget(...)`
  - `canDisplaySessionModel(...)`, `getSessionInstallHelp(...)`
- Renderer call sites use these shared helpers instead of agent-specific checks

## Current Implementation Status

### Shipped in Phase 1

- shared types include `gemini` as a first-class `SessionType`
- session records persist `geminiSessionId` with a dedicated database migration and unique index
- shared agent metadata in `src/shared/session-agents.ts` covers Gemini icon, default command, dialog mode, resume identity kind, and terminal cursor behavior
- shared create/launch helpers in `src/main/session/session-launch.ts` handle Gemini label prefixing, default command resolution, and create args
- Gemini session-list parsing and resume-index lookup live in `src/main/session/gemini-session-store.ts`
- renderer flows treat Gemini as an agent session in the new-session dialog, command palette, label handling, resume handling, sidebar visibility, tiles, and kanban
- devtools/MCP session tools accept `gemini` and expose a test/manual recovery setter for `geminiSessionId`
- unit coverage exists for the Gemini parser, launch helpers, resume helpers, label handling, and app-command wiring
- integration suites exist for Gemini support and Gemini resume

### Shipped in Phase 2

- dedicated Gemini integration fixture at `tests/fixtures/gemini`
- shared runtime capability helpers in `src/shared/session-capabilities.ts` drive renderer decisions
- agent runtime adapters extracted to `src/main/session/agent-runtimes/` with `afterCreate` and `prepareResume` delegated out of `SessionManager`
- Gemini `--model` support wired through the shared `session.model` path with model pill display
- resume hardening with parser-level and integration coverage for missing-ID and missing-from-list failures

Full details in [design-gemini-support-phase2.md](./design-gemini-support-phase2.md).

### Shipped Post-Phase 2

- **Adapter broadening**: `prepareCreate` and `pollState` added to the adapter interface. `SessionManager` now delegates all four adapter methods (`prepareCreate`, `afterCreate`, `prepareResume`, `pollState`) with zero agent-specific branching in the orchestrator.
- **Gemini CLI hook integration**: 7 hook events registered in `~/.gemini/settings.json`, bridge script at `~/.mcode/gemini-hook-bridge.sh`, event name normalization layer, `hookMode='live'` when bridge is ready, Gemini session ID capture from hook event payloads as an alternative to polling.
- **Codex hook parity**: `SessionEnd` and `Notification` added to Codex bridge events, bringing Codex to 7 events matching Gemini.

### Explicitly Deferred

- Gemini task queue support (`supportsTaskQueue: false` — now architecturally unblocked by live hooks)
- Gemini account-profile isolation (`supportsAccountProfiles: false`)
- Gemini sandbox, approval-mode, and yolo UI (CLI flags verified but no product wiring)
- Gemini-specific persistence shapes

## Verification Status

The current tree is in a good state for all shipped scope.

- `npm test` passes locally: 39 files, 515 tests
- Gemini-specific unit tests, hook config tests, and integration suites are included in that passing run
- Integration suites cover Gemini create, resume, resume failure paths, and model handling

## Open Risks And Decisions

### 1. Resume still depends on text parsing

`gemini --list-sessions --output-format json` still does not give reliable machine-readable output on `0.35.2`, so the parser remains text-based. All Gemini list parsing is isolated in `src/main/session/gemini-session-store.ts`. A Gemini CLI update that changes the list format would break resume without warning.

### 2. Project scoping is part of the contract

Gemini session discovery is cwd-sensitive. Resume resolution must continue to run in the session's original cwd.

### 3. The stored UUID is a locator, not the runtime token

The persisted Gemini UUID is the stable identity; the runtime resume argument is the current Gemini list index.

### 4. Hook bridge depends on external config file mutation

The Gemini integration writes to `~/.gemini/settings.json` at reconcile time and cleans up on quit. If mcode crashes without cleanup, stale hook entries remain. These are harmless (the bridge script checks `MCODE_HOOK_PORT` and exits silently when unset) but not clean.

### 5. Event name normalization is hardcoded

The `GEMINI_EVENT_MAP` in `hook-server.ts` maps 4 Gemini event names to mcode canonical names. A Gemini CLI update that changes event names would silently break hook-driven state transitions.

## Proposed Phase 3

Phase 3 should stay narrow: task queue enablement and resume durability.

Hooks are now live, which unblocks the single biggest functional gap between Gemini and Claude (task queue). Resume text parsing is the highest durability risk.

### WP0: CLI Preflight Verification

Reverify against the latest Gemini CLI version. Check whether `--output-format json` now produces usable structured output. Check whether hook event names have changed. Document findings.

### WP1: Gemini Task Queue Enablement

- Set `supportsTaskQueue: true` in `src/shared/session-agents.ts`
- Verify `canSessionQueueTasks()`, `canSessionBeTaskTarget()`, and `canSessionBeDefaultTaskTarget()` work correctly for Gemini sessions with `hookMode='live'`
- Add integration test coverage for Gemini task queue flow
- Sessions without the bridge (fallback mode) will not get task queue access because capability helpers gate on `hookMode === 'live'`

### WP2: Resume Parser Hardening

- Add a format-expectation check to `parseGeminiSessionList` that warns if the list output format looks unfamiliar (e.g., entries present but no bracketed UUIDs found)
- If `--output-format json` is now working, add a structured JSON parser as the primary path with the text parser as fallback
- Add a Gemini CLI version check at session create/resume time that logs a warning if the installed version differs from the verified version

### WP3: Hook Bridge Cleanup Hardening

- Add a startup scan for stale Gemini bridge entries left by prior crashes
- Reconcile check should remove entries pointing to dead `MCODE_HOOK_PORT` endpoints

### Explicitly Not In Phase 3

- Sandbox, approval-mode, and yolo UI (require product decisions about presentation)
- Account-profile isolation (significant scope; Gemini's account model needs investigation)
- Gemini-specific persistence shapes (no user-facing value until task queue or token tracking is live)
