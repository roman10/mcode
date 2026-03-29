# GitHub Copilot CLI Support — Phased Design

## Overview

mcode currently supports three agent types: Claude Code, Codex CLI, and Gemini CLI, plus plain terminal sessions. This document describes the design for adding GitHub Copilot CLI as a fourth supported agent.

GitHub Copilot CLI (`copilot`) reached GA on February 25, 2026. It is a fully interactive, PTY-based coding agent with session resume, model selection, structured JSON output, and a hook/plugin system — making it the most feature-complete addition since Gemini.

## Verified CLI Constraints

Based on Copilot CLI v1.0.12 (latest as of March 2026):

| Feature | Status | Details |
|---|---|---|
| Interactive mode | Yes | Default mode; chat-like terminal UI |
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

## Phase 1: MVP — Spawn, Display, Kill (~1.5 weeks)

Spawn and manage Copilot sessions with fallback status tracking. No hooks, no resume.

### Phase 1A: Pre-implementation refactoring

Apply R1, R2, and R3 refactors described above. These are small, low-risk, and independently verifiable.

### Phase 1B: Type system + DB migration

**Goal:** Add `'copilot'` to the type system and database. All existing code continues to work unchanged.

**`src/shared/types.ts`**
```typescript
// Before:
export type SessionType = 'claude' | 'codex' | 'gemini' | 'terminal';
// After:
export type SessionType = 'claude' | 'codex' | 'gemini' | 'copilot' | 'terminal';
```

Add `copilotSessionId: string | null` to `SessionInfo`.

**`src/shared/session-agents.ts`**
```typescript
export type AgentSessionType = 'claude' | 'codex' | 'gemini' | 'copilot';
export type AgentResumeIdentityKind = 'claudeSessionId' | 'codexThreadId' | 'geminiSessionId' | 'copilotSessionId' | null;
```

**`src/shared/constants.ts`**
```typescript
export const COPILOT_ICON = '\u2605'; // ★ (Black Star) — distinct from existing ✳❂✦
```

Icon choice rationale: GitHub's Copilot branding uses a star/sparkle motif. U+2605 (★) is visually distinct from Claude's ✳, Codex's ❂, and Gemini's ✦.

**DB migration `033_copilot_support.sql`:**
```sql
ALTER TABLE sessions ADD COLUMN copilot_session_id TEXT;
CREATE UNIQUE INDEX idx_sessions_copilot_session_id
  ON sessions (copilot_session_id) WHERE copilot_session_id IS NOT NULL;
```

### Phase 1C: Agent metadata + runtime adapter

**Agent definition:**
```typescript
copilot: {
  sessionType: 'copilot',
  displayName: 'Copilot CLI',
  icon: COPILOT_ICON,
  defaultCommand: 'copilot',
  supportsTaskQueue: false,     // Phase 2 — enable after hook bridge
  supportsPlanMode: false,      // Copilot uses /plan but not Claude-style plan mode
  hidesTerminalCursor: true,    // TBD — verify
  dialogMode: 'minimal',       // No permission mode, effort, worktree, account
  supportsAccountProfiles: false,
  supportsModelDisplay: true,   // Copilot supports --model
  resumeIdentityKind: 'copilotSessionId',
}
```

**Runtime adapter `src/main/session/agent-runtimes/copilot-runtime.ts`:**
- `prepareCreate`: build args (`copilot --prompt "initialPrompt"` if set, else bare `copilot`), pass `--model` if set, set `hookMode: 'fallback'`
- `afterCreate`: kick off background session-ID capture (poll `~/.copilot/session-state/` for new entries matching cwd + timing). Capture runs in Phase 1 so the identity is persisted early; resume functionality that uses it ships in Phase 2.
- `pollState`: fallback quiescence detector (same pattern as Codex/Gemini — watch PTY buffer for idle indicators)
- `prepareResume`: deferred to Phase 2 (not implemented in Phase 1)

### Phase 1D: UI integration

Most UI changes are metadata-driven via existing abstractions. A few hardcoded locations need manual updates:

- **Sidebar:** Copilot sessions appear with ★ icon (driven by `getAgentDefinition` — no change needed)
- **New Session Dialog:** Add Copilot to the hardcoded agent `<option>` list in `NewSessionDialog.tsx:140-149`; `dialogMode: 'minimal'` already hides Claude-specific fields
- **Kanban:** Copilot sessions appear (session type already generic — no change needed)
- **Tiles:** Copilot PTY renders in shared terminal component (no change needed)
- **Menu/Command Palette:** Uses a single generic "New Session" command — no per-agent entry needed
- **Ended session:** Resume gated by `getResumeIdentity()` in `session-resume.ts` — add `case 'copilotSessionId'` to the switch

**Hardcoded locations requiring update:**

| Location | What to update |
|---|---|
| `src/shared/types.ts:151` | Change `AppCommand`'s `new-session` sessionType to `AgentSessionType` (auto-includes `'copilot'` and future agents) |
| `src/renderer/components/Sidebar/NewSessionDialog.tsx:140-149` | Add `<option value="copilot">Copilot CLI</option>` |
| `src/renderer/utils/session-resume.ts:8-14` | Add `case 'copilotSessionId'` to `getResumeIdentity()` switch |
| `src/devtools/tools/session-tools.ts:35` | Add `'copilot'` to `session_create` Zod enum |

### Phase 1E: MCP devtools + testing

- Update `session_create` MCP tool Zod enum to include `'copilot'` (`session-tools.ts:35`)
- Add `session_set_copilot_session_id` MCP tool (follows existing `session_set_codex_thread_id` / `session_set_gemini_session_id` pattern in `session-tools.ts:325-367`)
- Add `SessionManager.setCopilotSessionId()` method (follows `setCodexThreadId` / `setGeminiSessionId` pattern)
- Create dedicated test fixture at `tests/fixtures/copilot/`
- Unit tests: agent metadata, create args builder, session-ID capture
- Integration tests: create Copilot session via MCP, verify sidebar/tile rendering, kill session

### Phase 1 deliverable

Users can create, view, interact with, and kill Copilot CLI sessions inside mcode. Status tracking uses fallback PTY polling. No resume, no hooks, no task queue.

---

## Phase 2: Hook Bridge + Resume (~2.5 weeks)

### Phase 2A: Hook bridge

**Goal:** Copilot sessions get `hookMode='live'` for real-time state tracking.

Copilot CLI v1.0.11+ supports user-scoped hooks at `~/.copilot/hooks/hooks.json`. This is the same pattern used for Gemini (`~/.gemini/settings.json` hooks). No project-scoped configuration needed.

**Approach: User-scoped hooks + bridge script**

mcode writes `~/.copilot/hooks/hooks.json` on startup, registering a bridge script for all 6 events. The bridge script at `~/.mcode/copilot-hook-bridge.sh` reads JSON from stdin and forwards it as an HTTP POST to `http://localhost:$MCODE_HOOK_PORT`. This is the same proven pattern used for Gemini.

**`~/.copilot/hooks/hooks.json`** (managed by mcode):
```json
{
  "version": 1,
  "hooks": {
    "sessionStart":        [{ "type": "command", "bash": "~/.mcode/copilot-hook-bridge.sh sessionStart" }],
    "sessionEnd":          [{ "type": "command", "bash": "~/.mcode/copilot-hook-bridge.sh sessionEnd" }],
    "preToolUse":          [{ "type": "command", "bash": "~/.mcode/copilot-hook-bridge.sh preToolUse" }],
    "postToolUse":         [{ "type": "command", "bash": "~/.mcode/copilot-hook-bridge.sh postToolUse" }],
    "userPromptSubmitted": [{ "type": "command", "bash": "~/.mcode/copilot-hook-bridge.sh userPromptSubmitted" }],
    "errorOccurred":       [{ "type": "command", "bash": "~/.mcode/copilot-hook-bridge.sh errorOccurred" }]
  }
}
```

**Bridge script** (`~/.mcode/copilot-hook-bridge.sh`): reads stdin JSON, wraps it with event name, POSTs to hook server. Same structure as Gemini bridge — could potentially share a single `~/.mcode/agent-hook-bridge.sh` across Gemini + Copilot since the forwarding logic is identical.

**Event mapping** (in `hook-server.ts`):

| Copilot Event | mcode Canonical | Notes |
|---|---|---|
| `sessionStart` | `SessionStart` | Input includes `source`: "new"/"resume"/"startup" |
| `sessionEnd` | `SessionEnd` | Input includes `reason`: "complete"/"error"/"abort"/"timeout"/"user_exit" |
| `preToolUse` | `PreToolUse` | Only hook whose output is used (`permissionDecision`) |
| `postToolUse` | `PostToolUse` | |
| `userPromptSubmitted` | `UserPromptSubmit` | |
| `errorOccurred` | `Error` | |

**Hook conflict handling:** User-scoped hooks merge with project-scoped `.github/hooks/hooks.json`. If the user has their own hooks, mcode's hooks append to the list (multiple hooks of the same type execute in order). mcode should only manage its own entries and not overwrite user hooks.

**Implementation note:** Unlike Gemini (which required reconciling a shared `settings.json`), `~/.copilot/hooks/` is less likely to have conflicts — it's a newer feature and fewer tools write there. However, users may add their own hooks manually, so mcode must merge rather than overwrite (see open question #4).

**Fallback:** If `~/.copilot/hooks/` is not supported (pre-v1.0.11), sessions remain in `hookMode='fallback'` with PTY-based polling. The runtime adapter should check Copilot version during `prepareCreate` and log a warning if user-scoped hooks aren't available.

**Files:** `src/main/hooks/copilot-hook-config.ts` (new), `src/main/hooks/hook-server.ts` (event mapping), `~/.mcode/copilot-hook-bridge.sh` (new)

### Phase 2B: Resume

**Goal:** Users can resume ended Copilot sessions.

**Session ID capture strategy:**

Copilot sessions are stored as UUID-named directories in `~/.copilot/session-state/`. Each contains a `workspace.yaml` with `id`, `cwd`, `created_at`, and `summary` fields. This is simpler than Codex (SQLite) and Gemini (text parsing).

1. After spawn, poll `~/.copilot/session-state/` for 15s (in `afterCreate`, started in Phase 1)
2. List directories, parse `workspace.yaml` for each new entry
3. Match by: exact `cwd` match AND `created_at` within ±5s of spawn time
4. If `sessionStart` hook fires with `source: "new"`, extract the session ID from the hook event directly (more reliable than polling — Phase 2A makes this available)
5. Persist matched UUID as `copilot_session_id`
6. If ambiguous or no match, leave NULL (non-resumable, same safety pattern as Codex)

**Dual capture path:** When hooks are live (Phase 2A), the `sessionStart` event delivers the session ID directly — no filesystem polling needed. When in fallback mode, filesystem polling is the backup. The adapter should prefer hook-based capture when available.

**Resume command:**
```
copilot --resume=<UUID>
```

**Session state parser:** `src/main/session/copilot-session-store.ts`
- Reads `~/.copilot/session-state/` directory listing
- Parses session identity from either `events.jsonl` first line (JSON, preferred — no new dependency) or `workspace.yaml` (requires YAML parser)
- Provides `findCopilotSessionId(cwd, spawnTime)` for post-create matching

**Runtime adapter updates:**
- `afterCreate`: prefer hook-delivered session ID; fall back to filesystem polling
- `prepareResume`: build `copilot --resume=<UUID>` command, set hookMode, reuse same `session_id`

**Renderer:**
- Enable resume button when `copilotSessionId` is present (capability-driven, no new branching)
- Same resumed-in-place UX as Codex/Gemini (clear `ended_at`, transition `ended → starting → idle`)

### Phase 2C: Model display

Copilot supports `--model` and `/model`. The `supportsModelDisplay: true` flag already gates the model pill in the UI. The `--model` flag is already passed in `prepareCreate` (Phase 1C). Phase 2C adds runtime model detection:

- If hook bridge is live, detect model changes from `session.model_change` events in `events.jsonl` or from hook event context
- If fallback mode, model display shows what was requested at creation time (already works from Phase 1)

### Phase 2 deliverable

Copilot sessions have real-time state tracking via hooks, can be resumed, and display model information. Feature set matches Codex/Gemini parity.

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
| `src/main/session/copilot-session-store.ts` | **New** | `workspace.yaml` parser + session matcher |
| `src/main/session/agent-runtimes/copilot-runtime.ts` | Modify | Implement hook-based + fallback session-ID capture, `prepareResume` |
| `~/.mcode/copilot-hook-bridge.sh` | **New** | Shell bridge script (same pattern as Gemini) |
| `~/.copilot/hooks/hooks.json` | **New** (managed) | User-scoped hook registration (written by mcode on startup) |

### Phase 3

No new files. Metadata flag changes + test coverage.

## Resolved Questions

1. **Hook scope:** Copilot v1.0.11+ supports user-scoped hooks at `~/.copilot/hooks/hooks.json`. These merge with project-scoped `.github/hooks/hooks.json`. No "extension" system — Copilot uses **plugins** (`~/.copilot/state/installed-plugins/`), which can also bundle hooks. User-scoped hooks are the recommended approach for mcode.

2. **Session state format:** Each session is a UUID-named directory in `~/.copilot/session-state/` containing `workspace.yaml` (YAML with `id`, `cwd`, `git_root`, `branch`, `summary`, `created_at`, `updated_at`), `events.jsonl` (chronological event stream), `session.db` (SQLite), and optional `plan.md`, `checkpoints/`, etc.

3. **`--resume` flag format:** `--resume=<UUID>` for specific session, `--continue` for most recent, `--resume` (no arg) for interactive fuzzy picker. `/session` slash command shows current session ID.

4. **`sessionStart` hook delivers session ID:** The `sessionStart` event includes session context, enabling hook-based session-ID capture without filesystem polling when hooks are live.

## Remaining Open Questions

1. **Idle detection:** What does Copilot's terminal output look like when idle? Need to characterize the TUI for fallback `pollState`. This blocks Phase 1C (runtime adapter) and should be resolved by running Copilot in a terminal and observing the PTY buffer.

2. **Cursor behavior:** Does Copilot hide the terminal cursor during operation? Affects `hidesTerminalCursor` metadata. Can be verified by inspecting PTY escape sequences.

3. **YAML parser dependency:** `workspace.yaml` needs parsing. However, `events.jsonl` contains a `session.start` event on line 1 with `sessionId`, `cwd`, `startTime`, and `context` in JSON — this may eliminate the YAML dependency entirely. If `events.jsonl` is sufficient for session matching, no new dependency is needed. Decision deferred to Phase 2B implementation.

4. **Hook merge behavior with user hooks:** If the user already has their own `~/.copilot/hooks/hooks.json`, mcode needs to merge rather than overwrite. Need to verify whether Copilot supports a `~/.copilot/hooks/` directory with multiple JSON files, or if it's a single `hooks.json` that must be merged.
