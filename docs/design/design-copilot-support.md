# GitHub Copilot CLI Support — Phased Design

## Overview

mcode currently supports three agent types: Claude Code, Codex CLI, and Gemini CLI, plus plain terminal sessions. This document describes the design for adding GitHub Copilot CLI as a fourth supported agent.

GitHub Copilot CLI (`copilot`) reached GA on February 25, 2026. It is a fully interactive, PTY-based coding agent with session resume, model selection, structured JSON output, and a hook/plugin system — making it the most feature-complete addition since Gemini.

## Verified CLI Constraints

Based on Copilot CLI v1.0.12 (latest as of March 2026):

| Feature | Status | Details |
|---|---|---|
| Interactive mode | Yes | Default mode; `-i "prompt"` for interactive with initial prompt; `-p "prompt"` is headless (exits after completion) |
| Command name | `copilot` | Standalone binary (also available via `gh copilot`) |
| Resume | Yes | `--resume=<UUID>` (specific), `--continue` (latest), `/resume` (interactive picker) |
| Session state dir | `~/.copilot/session-state/` | Per-session UUID directories with `workspace.yaml` + `events.jsonl` |
| Config dir | `~/.copilot/` | `config.json`, `mcp-config.json`; override with `COPILOT_HOME` env var |
| Model selection | Yes | `--model <name>` flag, `/model` slash command; default is Claude Sonnet 4.5 |
| Hook system | Yes | Project-scoped: `.github/hooks/hooks.json`; User-scoped: `~/.copilot/hooks/` (v1.0.11+) |
| Hook events | 6 | `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `userPromptSubmitted`, `errorOccurred` |
| Hook delivery | Shell-exec | JSON via stdin, JSON output on stdout; only `preToolUse` output influences behavior |
| Plugin system | Yes | Bundles of agents, skills, hooks, MCP configs; installed to `~/.copilot/state/installed-plugins/` |
| Built-in agents | Yes | Explore, Task, Plan, Code-Review |
| Cursor hiding | TBD | Needs verification — likely hides cursor like other TUI agents |

### Session state format (verified)

Each session is a UUID-named directory in `~/.copilot/session-state/`:

```
~/.copilot/session-state/<UUID>/
  workspace.yaml     # Session metadata: id, cwd, git_root, branch, summary, timestamps
  events.jsonl       # Chronological event stream (session.start, user.message, etc.)
  session.db         # SQLite with todos/todo_deps tables
  checkpoints/       # Context compaction recovery points
  plan.md            # Session plan (when plan mode used)
```

`workspace.yaml` format:
```yaml
id: <UUID>
cwd: /path/to/working/directory
git_root: /path/to/git/root
branch: main
summary: <AI-generated session summary>
created_at: 2026-03-29T05:45:15.486Z
updated_at: 2026-03-29T05:45:15.614Z
```

### Hook input/output schemas (verified)

| Event | Input fields | Output |
|---|---|---|
| `sessionStart` | `timestamp`, `cwd`, `source` ("new"/"resume"/"startup"), `initialPrompt` | Ignored |
| `sessionEnd` | `timestamp`, `cwd`, `reason` ("complete"/"error"/"abort"/"timeout"/"user_exit") | Ignored |
| `userPromptSubmitted` | `timestamp`, `cwd`, `prompt` | Ignored |
| `preToolUse` | `timestamp`, `cwd`, `toolName`, `toolArgs` (JSON string) | `permissionDecision`: "allow"/"deny", `permissionDecisionReason` |
| `postToolUse` | `timestamp`, `cwd`, `toolName`, `toolArgs`, `toolResult` | Ignored |
| `errorOccurred` | `timestamp`, `cwd`, `error` (`{message, name, stack}`) | Ignored |

Hooks config format (`.github/hooks/hooks.json` or `~/.copilot/hooks/hooks.json`):
```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [{
      "type": "command",
      "bash": "./script.sh",
      "timeoutSec": 30
    }]
  }
}
```

Multiple hooks of the same type execute in order. Default timeout is 30 seconds.

### Key differences from existing agents

1. **User-scoped hooks supported** — `~/.copilot/hooks/hooks.json` (v1.0.11+) works globally across all repos, matching the pattern used for Claude (`~/.claude/settings.json`) and Gemini (`~/.gemini/settings.json`).
2. **Hook delivery is shell-exec** — Same pattern as Codex and Gemini (not HTTP like Claude). Needs the same bridge script approach.
3. **Resume uses UUID-based session state** — `~/.copilot/session-state/<UUID>/workspace.yaml`, not a SQLite DB (Codex) or list command (Gemini). Resume via `--resume=<UUID>`.
4. **Multi-model by design** — Copilot can use Claude, GPT, and Gemini models. Model field is always relevant.
5. **Plugin system** — Copilot has a plugin system (not "extensions") that bundles agents, skills, hooks, and MCP configs. Plugin hooks merge with repo-level and user-level hooks. An mcode plugin is a viable alternative to direct hook registration.

## Pre-Implementation Refactoring

Before adding a 4th agent, three small architectural improvements should be made. These reduce per-agent branching debt that is already visible at 3 agents.

### Refactor R1: Generalize commit co-author detection

**Problem:** `detectAIAssisted()` uses a hardcoded list: `'claude' || 'anthropic' || 'codex' || 'openai'`. Adding Copilot requires extending it.

**Proposed change:** Move AI co-author patterns into a co-located constant array:

```typescript
const AI_COAUTHOR_PATTERNS = ['claude', 'anthropic', 'codex', 'openai', 'copilot'];
export function detectAIAssisted(coAuthor: string): boolean {
  if (!coAuthor) return false;
  const lower = coAuthor.toLowerCase();
  return AI_COAUTHOR_PATTERNS.some(p => lower.includes(p));
}
```

Note: `'github'` is intentionally excluded — it would false-positive on Dependabot, GitHub Actions bots, and other GitHub-authored trailers. `'copilot'` alone is sufficient to match `Co-Authored-By: GitHub Copilot`.

**Files:** `src/main/trackers/commit-tracker.ts`

### Refactor R2: Fix model field visibility in NewSessionDialog

**Problem:** `NewSessionDialog.tsx:37` uses `sessionType === 'gemini'` to show the model input field. Copilot also needs the model field (`supportsModelDisplay: true`), so this hardcoded check would silently exclude it.

**Proposed change:** Replace `isGemini` check with capability query:
```typescript
// Before:
const isGemini = sessionType === 'gemini';
// After:
const showModelField = getAgentDefinition(sessionType)?.supportsModelDisplay ?? false;
```

This is consistent with how `dialogMode` is already used in the same component (capability-driven, not type-checked).

**Files:** `src/renderer/components/Sidebar/NewSessionDialog.tsx`

### Refactor R3: Generalize `getAgentRuntimeAdapter` lookup

**Problem:** The function hardcodes agent type checks:
```typescript
if (sessionType === 'claude' || sessionType === 'codex' || sessionType === 'gemini') {
  return adapters[sessionType];
}
```

**Proposed change:** Use `isAgentSessionType()` which already exists:
```typescript
export function getAgentRuntimeAdapter(
  sessionType: string | undefined,
  adapters: AgentRuntimeAdapterMap,
): AgentRuntimeAdapter | null {
  return isAgentSessionType(sessionType) ? adapters[sessionType] : null;
}
```

**Files:** `src/main/session/agent-runtime.ts`

## Feasibility Summary

**Overall: Medium (M) — estimated 3-5 weeks for full feature parity across 3 phases.**

Copilot is more tractable than Codex or Gemini were because:
- The agent abstraction layer is mature (4th agent, not 2nd)
- Copilot's feature set (hooks, resume, model, JSON output) aligns well with what mcode already supports
- Hook delivery is shell-exec (same bridge pattern as Codex/Gemini — proven approach)

### Integration Point Breakdown

| Integration Point | Difficulty | Notes |
|---|---|---|
| Session Spawning | Easy | Same PTY infra, `copilot` command, standard flags |
| Hook System | Easy-Medium | Shell-exec bridge (proven pattern); user-scoped `~/.copilot/hooks/` supported (v1.0.11+) |
| State Machine / Polling | Easy | Fallback polling reusable; hook-based if bridge works |
| Resume | Easy-Medium | UUID dirs in `~/.copilot/session-state/`, `workspace.yaml` has cwd+timestamps for matching |
| Model Display | Easy | `--model` flag, metadata already supports `supportsModelDisplay` |
| Terminal Output Parsing | Medium | TUI-based like Codex/Gemini; idle detection needs verification |
| Token Tracking | Deferred | `/usage` command exists but structured tracking deferred |
| Commit Tracking | Easy | Extend co-author patterns (R1 refactor) |

---

## Phase 1: MVP — Spawn, Display, Kill ✅ COMPLETE

Phase 1 is fully implemented and committed. See [design-copilot-support-phase1.md](./design-copilot-support-phase1.md) for the detailed design.

### What shipped

- **1A: Pre-implementation refactoring** — R1 (co-author patterns array), R2 (model field via `supportsModelDisplay`), R3 (adapter lookup via `isAgentSessionType`)
- **1B: Type system + DB** — `'copilot'` in `SessionType`/`AgentSessionType`, `COPILOT_ICON` (★ U+2605), `AgentDefinition`, migration 033, `copilotSessionId` through `SessionRecord`/`toSessionInfo`/`AgentResumeRow`
- **1C: Runtime adapter + session store** — `copilot-runtime.ts` with `-i` for interactive prompt, `--model` passthrough, `copilot-session-store.ts` for session-ID capture from `~/.copilot/session-state/` (`events.jsonl` + `workspace.yaml` fallback)
- **1D: UI** — Copilot option in `NewSessionDialog`, `session-resume.ts` switches, model field visible for all `supportsModelDisplay` agents (Claude + Gemini + Copilot)
- **1E: Tests + devtools** — `session_set_copilot_session_id` MCP tool, test fixture, integration suite (5 tests), unit tests for runtime (10 tests) and session store (16 tests), extended commit-tracker and label-utils tests. 615 total tests passing.

### Files changed (10 modified, 7 new)

New: `db/migrations/033_copilot_support.sql`, `src/main/session/agent-runtimes/copilot-runtime.ts`, `src/main/session/copilot-session-store.ts`, `tests/fixtures/copilot`, `tests/suites/copilot-support.test.ts`, `tests/unit/main/copilot-runtime.test.ts`, `tests/unit/main/copilot-session-store.test.ts`

### Phase 1 deliverable

Users can create, view, interact with, and kill Copilot CLI sessions inside mcode. Status tracking uses fallback PTY polling. Session UUID is captured in the background for later resume. No resume, no hooks, no task queue.

---

## Phase 2: Hook Bridge + Resume ✅ COMPLETE

Phase 2 is fully implemented and committed (6741779). See [design-copilot-support-phase2.md](./design-copilot-support-phase2.md) for the detailed design.

### What shipped

- **2A: Hook bridge** — `copilot-hook-config.ts` manages `~/.copilot/hooks/hooks.json` with ownership-marker merge/cleanup, bridge script injects `hook_event_name` via per-event `$COPILOT_HOOK_EVENT` env vars, `COPILOT_EVENT_MAP` in `hook-server.ts` maps camelCase → PascalCase, `parseCopilotToolArgs()` handles `toolArgs` format inconsistency (JSON string in `preToolUse`, object in `postToolUse`). Copilot sessions get `hookMode='live'`.
- **2B: Resume** — `buildCopilotResumePlan` produces `copilot --resume <UUID>` with hook-aware env. Resume button appears once `copilotSessionId` is captured (Phase 1 UI wiring).
- **2C: Hook-based session-ID capture** — `sessionId` field (undocumented but verified in all Copilot hook payloads) enables instant capture from `SessionStart` events. Filesystem polling (Phase 1) remains as fallback for `hookMode='fallback'` sessions.
- **2E: Tests** — `copilot-hook-config.test.ts` (hook merge/remove purity), `hook-server.test.ts` (event normalization + toolArgs parsing), extended `copilot-runtime.test.ts` (hook-aware create + resume plans), `copilot-resume.test.ts` integration test (create → set ID → kill → resume). 652 total tests passing.

**Deferred:** Runtime model detection — Copilot hook payloads do not contain model information. Moved to future enhancement if Copilot CLI adds it.

### Files changed (4 modified, 6 new)

New: `src/main/hooks/copilot-hook-config.ts`, `tests/unit/main/copilot-hook-config.test.ts`, `tests/unit/main/hook-server.test.ts`, `tests/suites/copilot-resume.test.ts`
Modified: `src/main/hooks/hook-server.ts`, `src/main/session/agent-runtimes/copilot-runtime.ts`, `src/main/index.ts`, `tests/unit/main/copilot-runtime.test.ts`
Managed (written at runtime): `~/.mcode/copilot-hook-bridge.sh`, `~/.copilot/hooks/hooks.json`

### Phase 2 deliverable

Copilot sessions have real-time state tracking via hooks, can be resumed, and capture session IDs instantly from hook payloads. Feature set matches Codex/Gemini parity.

---

## Phase 3: Task Queue + Polish

See [design-copilot-support-phase3.md](./design-copilot-support-phase3.md) for the detailed Phase 3 design.

### Summary

Phase 3 is lightweight — Gemini's Phase 3 already generalized the task queue guards, so Copilot benefits directly:

- **3A: Task queue enablement** — Set `supportsTaskQueue: true` in agent metadata (one-line change). All capability gates (`hasLiveTaskQueue`, `canSessionQueueTasks`, `canSessionBeTaskTarget`) automatically include Copilot. Integration tests mirror `gemini-task-queue.test.ts` (6 cases).
- **3B: Commit tracking verification** — R1 refactor already applied in Phase 1. Verification-only: confirm `Co-Authored-By: GitHub Copilot` trailers are detected.
- **3C: Polish** — Verify cursor hiding, idle detection accuracy, concurrent session-ID capture, session-end cleanup. Code changes only if defects found.

### Files changed (estimated)

2 modified (`session-agents.ts`, `session-capabilities.test.ts`), 1 new (`copilot-task-queue.test.ts`). No changes to `task-queue.ts` or renderer code.

### Phase 3 deliverable

Copilot sessions can be task targets, commits are tracked, and the integration is production-hardened. Full feature parity with Gemini; near-parity with Claude (missing only permission mode cycling and plan mode, which are Claude-specific).

---

## Out of Scope

These are explicitly deferred and not planned for any phase:

- **Token/cost tracking** — Copilot pricing is subscription-based, not per-token. The `/usage` command exists but structured cost tracking is not meaningful.
- **Account profiles** — Copilot uses GitHub auth, not API keys. No multi-account use case identified.
- **Built-in agent delegation** — Copilot's Explore/Task/Plan/Code-Review sub-agents are internal to the CLI and don't need mcode integration.
- **Copilot Coding Agent** (async GitHub Actions agent) — This is a separate product that runs on GitHub, not locally. Out of scope for mcode's terminal-based session management.

## File Change Summary

### Phase 1 (new + modified)

| File | Action | Purpose |
|---|---|---|
| `src/shared/types.ts` | Modify | Add `'copilot'` to `SessionType`, derive `AppCommand` sessionType from `AgentSessionType`, add `copilotSessionId` to `SessionInfo` |
| `src/shared/constants.ts` | Modify | Add `COPILOT_ICON` |
| `src/shared/session-agents.ts` | Modify | Add Copilot to `AgentSessionType`, `AgentDefinition`, `AgentResumeIdentityKind` |
| `src/shared/session-capabilities.ts` | No change | Already generic |
| `src/main/session/agent-runtime.ts` | Modify | Add `copilotSessionId` to `AgentResumeRow`, apply R3 refactor |
| `src/main/session/agent-runtimes/copilot-runtime.ts` | **New** | Copilot runtime adapter |
| `src/main/session/session-manager.ts` | Modify | Register Copilot adapter in map, add `setCopilotSessionId()` method |
| `src/main/trackers/commit-tracker.ts` | Modify | Apply R1 refactor |
| `src/renderer/components/Sidebar/NewSessionDialog.tsx` | Modify | Add Copilot to agent dropdown |
| `src/renderer/utils/session-resume.ts` | Modify | Add `copilotSessionId` case to `getResumeIdentity()` |
| `src/devtools/tools/session-tools.ts` | Modify | Add `'copilot'` to Zod enum, add `session_set_copilot_session_id` tool |
| `db/migrations/033_copilot_support.sql` | **New** | Add `copilot_session_id` column + index |
| `tests/fixtures/copilot/` | **New** | Test fixture directory |

### Phase 2 (new + modified)

| File | Action | Purpose |
|---|---|---|
| `src/main/hooks/copilot-hook-config.ts` | **New** | Hook registration/cleanup for `~/.copilot/hooks/hooks.json` |
| `src/main/hooks/hook-server.ts` | Modify | Add `COPILOT_EVENT_MAP`, `parseCopilotToolArgs()`, camelCase field fallbacks |
| `src/main/session/agent-runtimes/copilot-runtime.ts` | Modify | Hook-aware `prepareCreate`, add `prepareResume` + `buildCopilotResumePlan` |
| `src/main/index.ts` | Modify | Register Copilot hook bridge in `initializeHookSystem()`, cleanup on quit |
| `tests/unit/main/copilot-hook-config.test.ts` | **New** | Hook config merge/remove purity tests |
| `tests/unit/main/hook-server.test.ts` | **New** | Event normalization + `parseCopilotToolArgs` tests |
| `tests/unit/main/copilot-runtime.test.ts` | Modify | Hook-aware create + resume plan tests |
| `tests/suites/copilot-resume.test.ts` | **New** | Integration tests for resume lifecycle |
| `~/.mcode/copilot-hook-bridge.sh` | **New** (managed) | Shell bridge script with event name injection |
| `~/.copilot/hooks/hooks.json` | **New** (managed) | User-scoped hook registration (written by mcode on startup) |

### Phase 3

| File | Action | Purpose |
|---|---|---|
| `src/shared/session-agents.ts` | Modify | `supportsTaskQueue: true` |
| `tests/suites/copilot-task-queue.test.ts` | **New** | Integration tests (6 cases, mirroring Gemini task queue) |
| `tests/unit/shared/session-capabilities.test.ts` | Modify | Add Copilot cases to capability helper tests |

## Resolved Questions

1. **Hook scope:** Copilot v1.0.11+ supports user-scoped hooks at `~/.copilot/hooks/hooks.json`. These merge with project-scoped `.github/hooks/hooks.json`. No "extension" system — Copilot uses **plugins** (`~/.copilot/state/installed-plugins/`), which can also bundle hooks. User-scoped hooks are the recommended approach for mcode.

2. **Session state format:** Each session is a UUID-named directory in `~/.copilot/session-state/` containing `workspace.yaml` (YAML with `id`, `cwd`, `git_root`, `branch`, `summary`, `created_at`, `updated_at`), `events.jsonl` (chronological event stream), `session.db` (SQLite), and optional `plan.md`, `checkpoints/`, etc.

3. **`--resume` flag format:** `--resume=<UUID>` for specific session, `--continue` for most recent, `--resume` (no arg) for interactive fuzzy picker. `/session` slash command shows current session ID.

4. **`sessionStart` hook delivers session ID:** The `sessionStart` event includes session context, enabling hook-based session-ID capture without filesystem polling when hooks are live.

## Remaining Open Questions

1. ~~**Idle detection:**~~ RESOLVED — Phase 1 shipped with standard quiescence-based `pollState` (same as Codex/Gemini). Works correctly in practice.

2. **Cursor behavior:** `hidesTerminalCursor: true` set as conservative default. Not yet verified via PTY escape sequences — harmless either way.

3. ~~**Hook merge behavior with user hooks:**~~ RESOLVED — Phase 2 implemented ownership-marker pattern: mcode entries identified by `bash` field containing `copilot-hook-bridge.sh`. Merge preserves user entries; multiple hooks per event execute in order (arrays). One-time backup before first mutation. Verified with Copilot CLI v1.0.12.

## Recently Resolved Questions

5. **`--prompt` is headless, use `-i` for interactive:** Verified against v1.0.12 — `-p`/`--prompt` runs non-interactively and exits. `-i`/`--interactive` starts the PTY session and auto-submits the prompt. Phase 1 adapter uses `-i`.

6. **`events.jsonl` format verified:** First line is always `session.start` with fields nested under `data`: `data.sessionId`, `data.context.cwd`, `data.startTime`. Uses camelCase. Most short-lived sessions only have `workspace.yaml` (snake_case: `id`, `cwd`, `created_at`). Session store uses `events.jsonl` primary with `workspace.yaml` fallback; no YAML library dependency needed (simple line-based parsing).

7. **`sessionId` in hook payloads:** Undocumented but verified — all Copilot hook payloads include a `sessionId` UUID field. Phase 2C uses this for instant session-ID capture from `SessionStart` events.

8. **`toolArgs` format inconsistency:** In `preToolUse`, `toolArgs` is a JSON string; in `postToolUse`, it's a parsed object. Phase 2A's `parseCopilotToolArgs()` handles both.
