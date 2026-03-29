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

## Phase 2: Hook Bridge + Resume

See [design-copilot-support-phase2.md](./design-copilot-support-phase2.md) for the detailed Phase 2 design.

### Summary

Phase 2 adds three capabilities on the Phase 1 foundation:

- **2A: Hook bridge** — `copilot-hook-config.ts` manages `~/.copilot/hooks/hooks.json`, bridge script forwards events to mcode's HTTP hook server, event name mapping in `hook-server.ts`. Copilot sessions get `hookMode='live'`.
- **2B: Resume** — `prepareResume` in the adapter builds `copilot --resume=<UUID>`. Session-ID capture upgraded to prefer hook-delivered ID when available, keeping filesystem polling as fallback.
- **2C: Runtime model detection** — Hook-based model change detection for live sessions; fallback shows create-time model (already works from Phase 1).

### Phase 2 deliverable

Copilot sessions have real-time state tracking via hooks, can be resumed, and display runtime model information. Feature set matches Codex/Gemini parity.

---

## Phase 3: Task Queue + Polish (~1 week)

### Phase 3A: Task queue enablement

**Prerequisite:** Hook bridge is stable and `hookMode='live'` works reliably.

**Changes:**
- Set `supportsTaskQueue: true` in Copilot agent metadata
- Existing capability helpers (`hasLiveTaskQueue`, `canSessionQueueTasks`) automatically gate this on `hookMode === 'live'`
- Verify task prompt injection works with Copilot's input handling
- Test task completion detection via `sessionEnd` / `postToolUse` events

### Phase 3B: Commit tracking

Apply R1 refactor if not already done. Copilot commits use `Co-Authored-By: ... GitHub Copilot ...` trailers. The `detectAIAssisted()` function needs `'copilot'` in its pattern list.

### Phase 3C: Polish

- Verify cursor hiding behavior; update `hidesTerminalCursor` if needed
- Verify idle detection accuracy in fallback mode
- Harden session-ID capture edge cases (concurrent sessions, rapid create/kill)
- Add `installHelpUrl` pointing to GitHub Copilot CLI docs
- Review and update integration tests for full lifecycle coverage

### Phase 3 deliverable

Copilot sessions can be task targets, commits are tracked, and the integration is production-hardened.

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
| `src/main/hooks/hook-server.ts` | Modify | Add Copilot event name mapping |
| `src/main/session/agent-runtimes/copilot-runtime.ts` | Modify | Add hook awareness to `prepareCreate`, implement `prepareResume` |
| `src/main/index.ts` | Modify | Register Copilot hook bridge in `initializeHookSystem()` |
| `~/.mcode/copilot-hook-bridge.sh` | **New** (managed) | Shell bridge script (same pattern as Gemini) |
| `~/.copilot/hooks/hooks.json` | **New** (managed) | User-scoped hook registration (written by mcode on startup) |

### Phase 3

No new files. Metadata flag changes + test coverage.

## Resolved Questions

1. **Hook scope:** Copilot v1.0.11+ supports user-scoped hooks at `~/.copilot/hooks/hooks.json`. These merge with project-scoped `.github/hooks/hooks.json`. No "extension" system — Copilot uses **plugins** (`~/.copilot/state/installed-plugins/`), which can also bundle hooks. User-scoped hooks are the recommended approach for mcode.

2. **Session state format:** Each session is a UUID-named directory in `~/.copilot/session-state/` containing `workspace.yaml` (YAML with `id`, `cwd`, `git_root`, `branch`, `summary`, `created_at`, `updated_at`), `events.jsonl` (chronological event stream), `session.db` (SQLite), and optional `plan.md`, `checkpoints/`, etc.

3. **`--resume` flag format:** `--resume=<UUID>` for specific session, `--continue` for most recent, `--resume` (no arg) for interactive fuzzy picker. `/session` slash command shows current session ID.

4. **`sessionStart` hook delivers session ID:** The `sessionStart` event includes session context, enabling hook-based session-ID capture without filesystem polling when hooks are live.

## Remaining Open Questions

1. ~~**Idle detection:**~~ RESOLVED — Phase 1 shipped with standard quiescence-based `pollState` (same as Codex/Gemini). Works correctly in practice.

2. **Cursor behavior:** `hidesTerminalCursor: true` set as conservative default. Not yet verified via PTY escape sequences — harmless either way.

3. **Hook merge behavior with user hooks:** If the user already has their own `~/.copilot/hooks/hooks.json`, mcode needs to merge rather than overwrite. Need to verify whether Copilot supports a `~/.copilot/hooks/` directory with multiple JSON files, or if it's a single `hooks.json` that must be merged. Blocks Phase 2A.

## Recently Resolved Questions

5. **`--prompt` is headless, use `-i` for interactive:** Verified against v1.0.12 — `-p`/`--prompt` runs non-interactively and exits. `-i`/`--interactive` starts the PTY session and auto-submits the prompt. Phase 1 adapter uses `-i`.

6. **`events.jsonl` format verified:** First line is always `session.start` with fields nested under `data`: `data.sessionId`, `data.context.cwd`, `data.startTime`. Uses camelCase. Most short-lived sessions only have `workspace.yaml` (snake_case: `id`, `cwd`, `created_at`). Session store uses `events.jsonl` primary with `workspace.yaml` fallback; no YAML library dependency needed (simple line-based parsing).
