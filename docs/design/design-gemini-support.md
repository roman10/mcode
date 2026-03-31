# Gemini CLI Support — Status And Forward Plan

## Overview

Gemini CLI support in mcode has progressed through four phases of work:

- **Phase 1** shipped the baseline Gemini lifecycle: create, display, kill, resume
- **Phase 2** completed maintainability refactors: dedicated fixture, shared capability helpers, agent runtime adapters, `--model` support, resume hardening
- **Post-Phase 2** landed hook-based state tracking: Gemini sessions now operate `hookMode='live'` when the bridge is ready, matching the architecture Claude and Codex use
- **Phase 3** shipped task queue enablement, resume parser hardening, and hook bridge cleanup hardening
- **Phase 4** shipped token/cost/input tracking via transcript scanning, with a scanner architecture refactor across all providers

SessionManager delegates all agent-specific logic to runtime adapters. Gemini is a first-class adapter alongside Claude, Codex, and Copilot with no special-case branching in the orchestrator.

This document serves three purposes:

- record what each phase delivered
- define the remaining gap list
- propose Phase 5 scope

Detailed Phase 1 implementation status lives in [design-gemini-support-phase1.md](./design-gemini-support-phase1.md).
Phase 2 final status lives in [design-gemini-support-phase2.md](./design-gemini-support-phase2.md).
The Phase 3 design lives in [design-gemini-support-phase3.md](./design-gemini-support-phase3.md).

## Verified CLI Constraints

The implementation is based on verified Gemini CLI behavior from `0.35.3` (reverified in Phase 3 WP0).

- Interactive startup uses positional prompt args: `gemini "prompt"`
- `--prompt` is headless and is not used for PTY-backed interactive sessions
- Resume uses `--resume <latest|index>`
- `gemini --list-sessions` is project-scoped and prints numbered entries with bracketed UUIDs
- `gemini --list-sessions --output-format json` still emits human-readable text as of `0.35.3`, so parsing remains text-based
- Hook registration works via `~/.gemini/settings.json` hook entries managed by mcode at startup (with stale-entry detection) and cleaned up on quit

One design consequence remains:

1. Resume must resolve a stored Gemini UUID back to the current list index via text parsing (mitigated by Phase 3 WP2 format-expectation validation).

## Architecture

The Gemini integration follows the shared agent runtime adapter pattern.

### Agent Runtime Adapters

- Interface defined in `src/main/session/agent-runtime.ts` with four optional hooks: `prepareCreate`, `afterCreate`, `prepareResume`, `pollState`
- Per-agent adapter implementations in `src/main/session/agent-runtimes/`:
  - `claude-runtime.ts` — full-featured (worktree, permission mode, effort, user-choice detection)
  - `codex-runtime.ts` — minimal (thread capture, resume, quiescence polling)
  - `gemini-runtime.ts` — session ID capture, index-based resume, quiescence polling, permission prompt detection
  - `copilot-runtime.ts` — session ID capture, resume, quiescence polling
- `SessionManager` is a pure orchestrator: create, resume, and pollSessionStates dispatch to adapters with no agent-specific branching

### Hook Integration

- Shared hook-bridge factory in `src/main/hooks/hook-bridge.ts` provides `writeBridgeScript()` and `reconcile()` for all agents
- Per-agent hook config files in `src/main/hooks/`:
  - `hook-config.ts` (Claude) — manages `~/.claude/settings.json`
  - `codex-hook-config.ts` — manages Codex hook registration
  - `gemini-hook-config.ts` — manages `~/.gemini/settings.json`
- Gemini registers 8 bridge events: `SessionStart`, `SessionEnd`, `BeforeTool`, `AfterTool`, `AfterAgent`, `BeforeAgent`, `Notification`, `BeforeModel`
- Bridge script at `~/.mcode/gemini-hook-bridge.sh` forwards events to mcode's HTTP hook server when `MCODE_HOOK_PORT` is set; exits silently for non-mcode sessions
- Event name normalization in `src/main/hooks/hook-server.ts` maps Gemini native names to mcode canonical names:
  - `BeforeTool` -> `PreToolUse`, `AfterTool` -> `PostToolUse`, `AfterAgent` -> `Stop`, `BeforeAgent` -> `UserPromptSubmit`
  - `SessionStart`, `SessionEnd`, `Notification`, `BeforeModel` pass through unchanged

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
- **Gemini CLI hook integration**: 8 hook events registered in `~/.gemini/settings.json` (including `BeforeModel` for model detection), bridge script at `~/.mcode/gemini-hook-bridge.sh`, event name normalization layer, `hookMode='live'` when bridge is ready, Gemini session ID capture from hook event payloads as an alternative to polling.
- **Codex hook parity**: `SessionEnd` and `Notification` added to Codex bridge events, bringing Codex to 7 events. Gemini has 8 (includes `BeforeModel` for model detection, which Codex does not use).

### Shipped in Phase 3

Full details in [design-gemini-support-phase3.md](./design-gemini-support-phase3.md).

- **WP0 — CLI preflight verification**: Reverified against Gemini CLI `0.35.3`. Confirmed `--output-format json` still emits text for `--list-sessions`. Confirmed all 8 hook event names unchanged. JSON parser deferred.
- **WP1 — Task queue enablement**: `supportsTaskQueue: true` in agent metadata, `supportsPlanMode` flag added to `AgentDefinition`, `hasLiveTaskQueue` exported from `session-capabilities.ts`, `TaskQueue.create()` widened to accept any agent with live task queue support, plan-mode and permission-mode tasks rejected for Gemini, ended-session resume guard widened via `resumeIdentityKind`.
- **WP2 — Resume parser hardening**: Format-expectation validation added to `parseGeminiSessionList()` (warns when output has content but no parseable sessions), improved resume error messages include available session IDs for diagnostics.
- **WP3 — Hook bridge cleanup hardening**: Bridge script existence check before reconcile, stale hook entry detection and logging during startup reconcile. Shared hook-bridge factory extracted to `src/main/hooks/hook-bridge.ts`.

### Shipped in Phase 4 (Token/Cost/Input Tracking)

Token, cost, and input tracking for Gemini sessions — the first item from the Phase 4 proposal — shipped on 2026-03-31.

**Architecture refactor (Step 0):**
- Extracted `ClaudeScanner` from `TokenTracker` into `src/main/trackers/claude-scanner.ts`, making `TokenTracker` a pure orchestrator + query layer
- All three providers now follow the same scanner pattern: `ClaudeScanner`, `CopilotScanner`, `GeminiScanner`

**Gemini transcript parser (`src/main/trackers/gemini-transcript-parser.ts`):**
- Pure parser (no DB, no side effects) for Gemini JSON transcripts at `~/.gemini/tmp/<projectDir>/chats/session-*.json`
- Token mapping: `inputTokens = tokens.input + tokens.tool`, `outputTokens = tokens.output + tokens.thoughts`, `cacheReadTokens = tokens.cached`
- Human input extraction from `type: "user"` messages for input tracking
- Message ID format: `gemini:{sessionId}:{message.id}`

**Gemini scanner (`src/main/trackers/gemini-scanner.ts`):**
- Discovers transcript files via `~/.gemini/tmp/*/chats/session-*.json` glob
- Full-file reads with upsert (`ON CONFLICT DO UPDATE`), matching Copilot pattern (unlike Claude's incremental byte-offset approach)
- Watermark tracking via `tracked_jsonl_files` table with `provider='gemini'`

**Gemini pricing (`src/main/trackers/token-cost.ts`):**
- 7 models priced (verified against ai.google.dev/gemini-api/docs/pricing on 2026-03-31):
  - `gemini-3.1-pro` ($2.00/$12.00), `gemini-3.1-flash-lite` ($0.25/$1.50), `gemini-3-flash` ($0.50/$3.00)
  - `gemini-2.5-pro` ($1.25/$10.00), `gemini-2.5-flash` ($0.30/$2.50), `gemini-2.5-flash-lite` ($0.10/$0.40)
  - `gemini-2.0-flash` ($0.10/$0.40, deprecated — shutdown June 2026)
- `estimateCostUsd()` falls back to `GEMINI_PRICING` when `MODEL_PRICING` lookup fails
- `normalizeModelFamily()` recognizes `'gemini'`

**Hook integration:**
- `handleHookEvent` return type changed from `boolean` to `AgentSessionType | false` for type-safe provider dispatch
- `onHookEvent` routes Gemini `Stop` events to `GeminiScanner.scanFile()` for immediate post-session scanning

**Capability flags enabled in `src/shared/session-agents.ts`:**
- `supportsTokenTracking: true`, `supportsCostEstimation: true`, `supportsInputTracking: true`

**Test coverage:**
- 14 unit tests for Gemini transcript parser (token extraction, human messages, edge cases)
- 4 unit tests for Gemini pricing in `token-cost.test.ts` (model family detection, cost calculation)
- 9 unit tests for `normalizeGeminiModel()` normalization

| Key Commits | Description |
|-------------|-------------|
| `8819f8e` | feat: add Gemini token tracking with scanner architecture refactor |
| `f006c9e` | fix: correct Gemini model pricing to match published API rates |

### Explicitly Deferred

- Gemini plan mode (`supportsPlanMode: false` — Gemini CLI has no plan-mode concept)
- Gemini account-profile isolation (`supportsAccountProfiles: false`)
- Gemini sandbox, approval-mode, and yolo UI (CLI flags verified but no product wiring)
- Gemini-specific persistence shapes
- JSON session list parser (Gemini CLI `--output-format json` still does not produce structured output as of `0.35.3`)

## Verification Status

The current tree is in a good state for all shipped scope.

- `npm test` passes locally
- Gemini-specific test coverage: 9 test files, 78 tests (19 unit for runtime, 11 unit for session store, 8 unit for hook config, 14 unit for transcript parser, 13 unit for pricing/normalization, 4 integration for support, 3 integration for resume, 6 integration for task queue)
- Integration suites cover Gemini create, resume, resume failure paths, model handling, and task queue dispatch/rejection
- Token tracking verified via unit tests; integration test for end-to-end token flow is a known gap (see Phase 5 proposals)

## Open Risks And Decisions

### 1. Resume still depends on text parsing

`gemini --list-sessions --output-format json` still does not give reliable machine-readable output as of `0.35.3`, so the parser remains text-based. All Gemini list parsing is isolated in `src/main/session/gemini-session-store.ts`. **Mitigated in Phase 3 WP2:** `parseGeminiSessionList()` now logs a warning when output contains content but no parseable sessions, providing early detection of format changes.

### 2. Project scoping is part of the contract

Gemini session discovery is cwd-sensitive. Resume resolution must continue to run in the session's original cwd.

### 3. The stored UUID is a locator, not the runtime token

The persisted Gemini UUID is the stable identity; the runtime resume argument is the current Gemini list index.

### 4. Hook bridge depends on external config file mutation

The Gemini integration writes to `~/.gemini/settings.json` at reconcile time and cleans up on quit. If mcode crashes without cleanup, stale hook entries remain. These are harmless (the bridge script checks `MCODE_HOOK_PORT` and exits silently when unset) but not clean. **Mitigated in Phase 3 WP3:** Startup reconcile now detects and logs removal of stale bridge hooks, and validates bridge script existence before registering hooks.

### 5. Event name normalization is hardcoded

The `GEMINI_EVENT_MAP` in `hook-server.ts` maps 4 of 8 Gemini event names to mcode canonical names (the other 4 pass through unchanged). A Gemini CLI update that changes event names would silently break hook-driven state transitions. Phase 3 WP0 confirmed event names are stable as of `0.35.3`.

### 6. Thinking token billing may diverge from output rate

Gemini `thoughts` tokens are currently mapped to `outputTokens` and billed at the output rate. If Google introduces separate thinking token pricing (as Anthropic did for extended thinking), the `GEMINI_PRICING` table and cost calculation would need a `thinking` rate. Low risk — no indication this is imminent.

### 7. Gemini transcript path depends on `~/.gemini/tmp/` convention

The scanner discovers transcripts at `~/.gemini/tmp/*/chats/session-*.json`. This path is not documented by Google and was discovered empirically. A Gemini CLI update that changes the transcript location would silently break token scanning. The glob pattern is isolated in `GeminiScanner.scanAll()`.

## Phase 3 (Shipped)

Phase 3 delivered task queue enablement, resume parser hardening, and hook bridge cleanup hardening. All 4 work packages are complete. Detailed design and implementation notes in [design-gemini-support-phase3.md](./design-gemini-support-phase3.md).

| WP | Scope | Key Commits |
|----|-------|-------------|
| WP0 | CLI preflight verification (v0.35.3) | `5f7d609` |
| WP1 | Task queue enablement | `88d2769` |
| WP2 | Resume parser hardening | `88d2769` |
| WP3 | Hook bridge cleanup hardening | `5f7d609` |

## Phase 4 (Shipped)

Phase 4 WP1 (Token/Cost Tracking) shipped on 2026-03-31. See "Shipped in Phase 4" above for full details.

**Investigation result:** Gemini CLI hook event payloads (`AfterAgent`/`Stop`) contain a `transcript_path` field but no inline token data. The solution scans the transcript JSON file (which does contain per-message token breakdowns) triggered by Stop hook events, with background polling as a fallback.

| WP | Scope | Key Commits |
|----|-------|-------------|
| WP1 | Token/cost/input tracking + scanner refactor | `8819f8e`, `f006c9e` |

## Proposed Phase 5

Phase 5 candidates are gated on Gemini CLI evolution and test coverage hardening.

### WP1: Gemini Token Tracking Integration Test

Add `tests/suites/gemini-token-tracking.test.ts` to verify end-to-end token flow:

- Create a Gemini session via MCP → let it reach idle (produces transcript)
- Trigger `tokens:refresh` via MCP
- Query `tokens:get-session-usage` and `tokens:get-daily-usage` with `provider=gemini`
- Verify token data appears with correct provider, model, and cost
- If the fixture doesn't produce real transcripts, create a synthetic transcript file and trigger scanning

### WP2: GeminiScanner Unit Tests

Add `tests/unit/main/gemini-scanner.test.ts` covering:

- File discovery glob matches expected path patterns
- Watermark skip behavior (unchanged file size → no re-processing)
- Upsert behavior on re-scan (updated token counts overwrite previous)
- Error handling for unreadable/missing files and malformed JSON
- Follows the pattern in `tests/unit/main/copilot-scanner.test.ts` if it exists, or `tests/unit/main/claude-scanner.test.ts`

### WP3: JSON Session List Parser

Monitor Gemini CLI releases for proper `--output-format json` support. When available:

- Add `parseGeminiSessionListJson()` as the primary parser path with text parser as in-process fallback (design already exists in [Phase 3 doc](./design-gemini-support-phase3.md))
- Single `execFileSync` call with `--output-format json` flag; JSON parse failure falls back to text parsing of the same output
- Remove format-expectation warning once JSON parsing is the primary path

### WP4: Gemini Sandbox/Approval Mode

If Gemini CLI adds sandbox or approval-mode flags:

- Wire flags through the session create dialog
- Add UI presentation for sandbox/approval state (requires product decision)

### Explicitly Not In Phase 5

- Account-profile isolation (significant scope; Gemini's account model needs investigation)
- Plan mode (Gemini CLI has no plan-mode concept)
- Thinking token pricing differentiation (currently `thoughts` billed at output rate; revisit if Google introduces separate thinking token pricing)
