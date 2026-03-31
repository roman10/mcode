# Codex CLI Support — Status And Forward Plan

## Overview

Codex CLI was the first non-Claude agent added to mcode. Support has progressed through six phases of work:

- **Phase 1** — Session lifecycle: create, display, kill, commit tracking, new-session dialog
- **Phase 2** — Hook integration (bridge script, live state tracking) and full resume support
- **Phase 3** — Task queue with `hasPendingTasks` attention suppression
- **Phase 4** — Slash command support with inline validation warnings
- **Phase 5** — Model display via hook payload extraction with GPT family color
- **Phase 6** — Token/cost/input tracking via JSONL transcript scanning with OpenAI pricing

SessionManager delegates all agent-specific logic to runtime adapters. Codex is a first-class adapter alongside Claude, Gemini, and Copilot with no special-case branching in the orchestrator.

This document serves three purposes:

- record what each phase delivered
- define the remaining gap list
- propose next steps

Detailed resume design lives in [design-codex-resume.md](./design-codex-resume.md).

## Verified CLI Constraints

| Feature | Status | Details |
|---|---|---|
| Command name | `codex` | Standalone binary |
| Interactive mode | Yes | Positional prompt arg: `codex "prompt"` |
| Resume | Yes | `codex resume <threadId>` |
| State store | `~/.codex/state_*.sqlite` | `threads` table with thread ID, CWD, timestamps |
| Hook system | Experimental | Requires `--enable codex_hooks` flag |
| Hook delivery | Shell-exec | JSON via stdin, JSON output on stdout |
| Hook events | 7 | `SessionStart`, `SessionEnd`, `PreToolUse`, `PostToolUse`, `Stop`, `UserPromptSubmit`, `Notification` |
| Plan mode | No | No plan-mode concept |
| Token output | Yes | Per-API-call `token_count` events in JSONL transcripts (`~/.codex/sessions/`) with `last_token_usage` breakdowns |
| Model selection | Yes | `payload.model` field in all hook events; `/model` slash command in CLI |

## Architecture

The Codex integration follows the shared agent runtime adapter pattern.

### Agent Runtime Adapters

- Interface defined in `src/main/session/agent-runtime.ts` with four optional hooks: `prepareCreate`, `afterCreate`, `prepareResume`, `pollState`
- Per-agent adapter implementations in `src/main/session/agent-runtimes/`:
  - `claude-runtime.ts` — full-featured (worktree, permission mode, effort, user-choice detection)
  - `codex-runtime.ts` — thread capture, hook-aware create/resume, quiescence polling, permission prompt detection
  - `gemini-runtime.ts` — session ID capture, index-based resume, quiescence polling
  - `copilot-runtime.ts` — session ID capture, resume, quiescence polling
- `SessionManager` is a pure orchestrator: create, resume, and pollSessionStates dispatch to adapters with no agent-specific branching

### Hook Integration

- Shared hook-bridge factory in `src/main/hooks/hook-bridge.ts` provides `writeBridgeScript()` and `reconcile()` for all non-Claude agents
- Codex hook config in `src/main/hooks/codex-hook-config.ts` manages `~/.codex/hooks.json`
- 7 bridge events registered: `SessionStart`, `SessionEnd`, `PreToolUse`, `PostToolUse`, `Stop`, `UserPromptSubmit`, `Notification`
- Bridge script at `~/.mcode/codex-hook-bridge.sh` forwards events via curl to mcode's HTTP hook server when `MCODE_HOOK_PORT` is set; exits silently for non-mcode sessions
- No event name normalization needed — Codex uses mcode-standard event names natively (unlike Gemini and Copilot which require mapping)

### Shared Capability System

- Agent metadata in `src/shared/session-agents.ts` (`AgentDefinition` record for codex)
- Shared capability queries in `src/shared/session-capabilities.ts`:
  - `canSessionQueueTasks(...)`, `canSessionBeTaskTarget(...)`, `canSessionBeDefaultTaskTarget(...)`
  - `canDisplaySessionModel(...)`, `getSessionInstallHelp(...)`
  - `supportsSessionSlashCommands(...)`, `getSessionSlashCommandSupport(...)`, `getSessionSlashCommandHelp(...)`
- Per-agent slash command definitions (`slashCommands` in `AgentDefinition`): builtin commands, custom command file sources, description parsing rules
- Renderer call sites use these shared helpers instead of agent-specific checks

## Current Implementation Status

### Shipped: Session Lifecycle (Phase 1)

- `'codex'` in `SessionType` union, `CODEX_ICON` (U+2742 `❂`), `AgentDefinition` with capability flags
- DB migration 028 (session type marker), migration 030 (`codex_thread_id` column with unique index)
- `codex-runtime.ts` adapter: `prepareCreate` (hook-aware args with `--enable codex_hooks`), `afterCreate` (thread capture scheduling), `prepareResume` (thread-ID resume), `pollState` (quiescence + permission prompt detection)
- `codex-session-store.ts` for thread-ID capture from `~/.codex/state_*.sqlite` with ranked candidate matching (prompt, title, newest creation), CWD filtering, and ownership deduplication
- UI: new-session dialog with Codex agent type option, `new-codex-session` command palette entry, sidebar/kanban/tile display, terminal cursor hidden
- Commit tracking: `detectAIAssisted()` and `detectAIProvider()` with `'codex'`/`'openai'` co-author patterns; `detected_provider` column added in migration 036

### Shipped: Hooks + Resume (Phase 2)

- Hook bridge: `codex-hook-config.ts` manages `~/.codex/hooks.json` registration, bridge script at `~/.mcode/codex-hook-bridge.sh`, `hookMode='live'` when bridge is ready and hook server is active
- Dual-mode operation: live (hook-driven state transitions) with fallback (PTY polling as safety net)
- Resume: `codex resume <threadId>` via `buildCodexResumePlan()`, renderer resume button gated on `codexThreadId` presence, in-place semantics (reuses mcode `session_id`, preserves tile position)
- Devtools `session_set_codex_thread_id` tool for manual recovery
- Detailed resume design in [design-codex-resume.md](./design-codex-resume.md)

### Shipped: Task Queue (Phase 3)

- `supportsTaskQueue: true` in agent definition — Codex sessions with `hookMode='live'` accept tasks
- pollState `hasPendingTasks` suppression — prevents attention flicker between task dispatches (also fixed for Copilot and Gemini pollState functions)
- Permission-mode and plan-mode tasks correctly rejected (same as Copilot/Gemini)
- Ended Codex sessions auto-resume for task dispatch when `codexThreadId` is present
- Shared `describeAgentTaskQueue()` test factory in `tests/helpers.ts` — DRY integration tests for all non-Claude agents

### Shipped: Slash Command Support (Phase 4)

- `slashCommands` field in `AgentDefinition` with Codex-specific builtin commands (`/plan`, `/help`, etc.)
- `supportsSessionSlashCommands()`, `getSessionSlashCommandSupport()` capability queries
- Inline unsupported-command warnings in autocomplete panel
- Toolbar badge with auto-dismiss for invalid slash command attempts

### Shipped: Model Display (Phase 5)

- `supportsModelDisplay: true` — Codex sessions show a model pill in tiles, sidebar, and kanban
- Model extracted from `payload.model` on every Codex hook event (present in `SessionStart`, `UserPromptSubmit`, etc.)
- No normalization needed — Codex model strings are clean (e.g., `gpt-5.4`, `gpt-5.1-codex-mini`)
- Model updates mid-session when Codex switches models (e.g., rate limit fallback)
- GPT model family added to ModelPill with teal color (also benefits Copilot sessions)

### Shipped: Token/Cost/Input Tracking (Phase 6)

- `supportsTokenTracking: true`, `supportsCostEstimation: true`, `supportsInputTracking: true`
- `CodexScanner` in `src/main/trackers/codex-scanner.ts` discovers JSONL transcripts in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- `codex-transcript-parser.ts` — pure parser extracts per-API-call token counts from `token_count` events and human input from `user_message` events
- Model tracked from `turn_context` events across turns; `token_count` events with `info: null` (rate-limited) are skipped
- OpenAI model pricing table (`OPENAI_PRICING`) in `token-cost.ts` with 9 models (gpt-5.4 through gpt-5)
- Full-file scan with INSERT OR IGNORE (per-call entries are immutable) + watermark tracking
- Hook-triggered scan on Codex `Stop` events via `transcript_path` in payload

### Explicitly Deferred

- **Account profiles** (`supportsAccountProfiles: false`) — Codex uses API key auth; no multi-account use case investigated
- **Plan mode** (`supportsPlanMode: false`) — Codex has `/plan` slash command but no mcode integration for plan-mode task queue features

## Verification Status

Codex-specific test coverage spans 8 test files:

- `tests/unit/main/codex-runtime.test.ts` — runtime adapter unit tests (create, resume, pollState, hasPendingTasks)
- `tests/unit/main/codex-session-store.test.ts` — thread-ID capture and matching logic
- `tests/unit/main/codex-transcript-parser.test.ts` — JSONL transcript parser (tokens, human input, model tracking, edge cases)
- `tests/unit/main/codex-hook-config.test.ts` — hook config merge/remove pure functions
- `tests/unit/shared/session-capabilities.test.ts` — capability flags and queries (shared across all agents)
- `tests/suites/codex-support.test.ts` — integration: create, display, kill Codex sessions
- `tests/suites/codex-resume.test.ts` — integration: resume with thread ID, failure paths
- `tests/suites/codex-task-queue.test.ts` — integration: task dispatch, sequential, rejections, session-end failure (shared factory `describeAgentTaskQueue`)

Fixture data in `tests/fixtures/codex`.

## Open Risks And Decisions

### 1. Hook API stability

Codex hooks are still experimental — the `--enable codex_hooks` flag is required. Hook event names or delivery format could change in future Codex releases. Mitigation: bridge script is thin; fallback polling is always available and provides basic state tracking without hooks.

### 2. Thread capture relies on SQLite snooping

Thread-ID capture reads `~/.codex/state_*.sqlite` directly (the `threads` table). Codex could change its storage format or location. Mitigation: capture failure is graceful — the session remains usable, just not resumable.

### 3. No reliable task-completion signal

Codex emits `Stop` events but their reliability for task-completion detection has not been validated. Quiescence-based detection (the same approach Copilot uses) is the fallback strategy.

## Proposed Next Steps

### 1. Cross-Agent Architecture Documentation

**Priority: Low. Effort: Small.**

Create `design-multi-agent-architecture.md` providing a single-page overview of:
- The `AgentRuntimeAdapter` interface and adapter map
- The `AgentDefinition` capability matrix (all flags)
- The hook bridge factory pattern and event normalization layer
- The scanner/tracker system for each agent
- How to add a new agent

Each per-agent doc would link to it as the architectural reference.
