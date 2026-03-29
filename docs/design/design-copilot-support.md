# GitHub Copilot CLI Support — Phased Design

## Overview

mcode currently supports three agent types: Claude Code, Codex CLI, and Gemini CLI, plus plain terminal sessions. This document describes the design for adding GitHub Copilot CLI as a fourth supported agent.

GitHub Copilot CLI (`copilot`) reached GA on February 25, 2026. It is a fully interactive, PTY-based coding agent with session resume, model selection, structured JSON output, and a hook/extension system — making it the most feature-complete addition since Gemini.

## Verified CLI Constraints

Based on Copilot CLI GA (v0.0.342+):

| Feature | Status | Details |
|---|---|---|
| Interactive mode | Yes | Default mode; chat-like terminal UI |
| Command name | `copilot` | Standalone binary (also available via `gh copilot`) |
| Resume | Yes | `--resume`, `--continue`, `/resume` slash command |
| Session state dir | `~/.copilot/session-state/` | Per-session files, complete history |
| Config dir | `~/.copilot/` | `config.json`, `mcp-config.json` |
| Model selection | Yes | `--model <name>` flag, `/model` slash command |
| JSON output | Yes | `--output-format=json` emits JSONL |
| Hook system | Yes | JSON configs in `.github/hooks/<name>.json` (project-scoped) |
| Hook events | 6 | `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `userPromptSubmitted`, `errorOccurred` |
| Extension system | Yes | `.mjs` extensions in `.github/extensions/` and `~/.copilot/extensions/` |
| Built-in agents | Yes | Explore, Task, Plan, Code-Review |
| Cursor hiding | TBD | Needs verification — likely hides cursor like other TUI agents |

### Key differences from existing agents

1. **Hooks are project-scoped** — `.github/hooks/` in the repo, not `~/.copilot/settings.json`. User-scoped hooks may also work via `~/.copilot/extensions/`.
2. **Hook delivery is shell-exec** — Same pattern as Codex and Gemini (not HTTP like Claude). Needs the same bridge script approach.
3. **Resume uses file-based session state** — `~/.copilot/session-state/` directory, not a SQLite DB (Codex) or list command (Gemini).
4. **Multi-model by design** — Copilot can use Claude, GPT, and Gemini models. Model field is always relevant.

## Pre-Implementation Refactoring

Before adding a 4th agent, two small architectural improvements should be made. These reduce per-agent branching debt that is already visible at 3 agents.

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

### Refactor R2: Generalize `getAgentRuntimeAdapter` lookup

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
| Hook System | Medium | Shell-exec bridge (proven pattern), but project-scoped hooks are new |
| State Machine / Polling | Easy | Fallback polling reusable; hook-based if bridge works |
| Resume | Medium | File-based `~/.copilot/session-state/`, needs discovery + matching |
| Model Display | Easy | `--model` flag, metadata already supports `supportsModelDisplay` |
| Terminal Output Parsing | Medium | TUI-based like Codex/Gemini; idle detection needs verification |
| Token Tracking | Deferred | `/usage` command exists but structured tracking deferred |
| Commit Tracking | Easy | Extend co-author patterns (R2 refactor) |

---

## Phase 1: MVP — Spawn, Display, Kill (~1.5 weeks)

Spawn and manage Copilot sessions with fallback status tracking. No hooks, no resume.

### Phase 1A: Pre-implementation refactoring

Apply R1 and R2 refactors described above. These are small, low-risk, and independently verifiable.

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
- `prepareCreate`: build args (`copilot [initialPrompt]`), pass `--model` if set, set `hookMode: 'fallback'`
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
| `src/shared/types.ts:151` | Add `'copilot'` to `AppCommand`'s `new-session` sessionType union |
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

Copilot's hook system is project-scoped (`.github/hooks/`), which differs from Claude (`~/.claude/settings.json`) and Gemini (`~/.gemini/settings.json`). Two approaches:

**Option A: User-scoped extension (preferred)**
- Write a `.mjs` extension to `~/.copilot/extensions/mcode-bridge.mjs`
- Extension uses JSON-RPC to receive lifecycle events and forwards them to `http://localhost:$MCODE_HOOK_PORT`
- mcode installs/updates the extension on startup, removes on quit
- Pro: Works across all repos without modifying `.github/`; mirrors how Claude/Gemini hooks work
- Con: Extension API stability risk (newer feature)

**Option B: Bridge shell script (fallback)**
- Register hook scripts in a well-known project location
- Bridge script at `~/.mcode/copilot-hook-bridge.sh` (same pattern as Gemini)
- Con: Project-scoped means it only works in repos where hooks are configured

**Event mapping:**
| Copilot Event | mcode Canonical |
|---|---|
| `sessionStart` | `SessionStart` |
| `sessionEnd` | `SessionEnd` |
| `preToolUse` | `PreToolUse` |
| `postToolUse` | `PostToolUse` |
| `userPromptSubmitted` | `UserPromptSubmit` |
| `errorOccurred` | `Error` |

**Hook config:** `src/main/hooks/copilot-hook-config.ts`

**Files:** `src/main/hooks/copilot-hook-config.ts`, `src/main/hooks/hook-server.ts` (event mapping), bridge script

### Phase 2B: Resume

**Goal:** Users can resume ended Copilot sessions.

**Session ID capture strategy:**
1. After spawn, poll `~/.copilot/session-state/` for 15s
2. Look for new session files created after spawn time
3. Match by: cwd, creation time proximity, prompt content if available
4. Persist matched session ID as `copilot_session_id`
5. If ambiguous, leave NULL (non-resumable, same safety pattern as Codex)

**Resume command:**
```
copilot --resume <session-id>
```

**Session state parser:** `src/main/session/copilot-session-store.ts`
- Reads `~/.copilot/session-state/` directory
- Parses session files to extract session ID, cwd, timestamp, prompt
- Provides `findCopilotSessionId(cwd, spawnTime, initialPrompt)` for post-create matching

**Runtime adapter updates:**
- `afterCreate`: implement session-ID capture polling
- `prepareResume`: build `copilot --resume <id>` command, set hookMode, reuse same `session_id`

**Renderer:**
- Enable resume button when `copilotSessionId` is present (capability-driven, no new branching)
- Same resumed-in-place UX as Codex/Gemini (clear `ended_at`, transition `ended → starting → idle`)

### Phase 2C: Model display

Copilot supports `--model` and `/model`. The `supportsModelDisplay: true` flag already gates the model pill in the UI. Implementation:

- Pass `--model` in `prepareCreate` when `input.model` is set
- If hook bridge is live, capture model from session events
- If fallback mode, model display shows what was requested at creation time

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
| `src/shared/types.ts` | Modify | Add `'copilot'` to `SessionType`, add `copilotSessionId` to `SessionInfo` |
| `src/shared/constants.ts` | Modify | Add `COPILOT_ICON` |
| `src/shared/session-agents.ts` | Modify | Add Copilot to `AgentSessionType`, `AgentDefinition`, `AgentResumeIdentityKind` |
| `src/shared/session-capabilities.ts` | No change | Already generic |
| `src/main/session/agent-runtime.ts` | Modify | Add `copilotSessionId` to `AgentResumeRow`, apply R2 refactor |
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
| `src/main/hooks/copilot-hook-config.ts` | **New** | Hook registration/cleanup |
| `src/main/hooks/hook-server.ts` | Modify | Add Copilot event name mapping |
| `src/main/session/copilot-session-store.ts` | **New** | Session state directory parser |
| `src/main/session/agent-runtimes/copilot-runtime.ts` | Modify | Implement afterCreate + prepareResume |
| `~/.mcode/copilot-hook-bridge.mjs` | **New** | Bridge extension (or .sh fallback) |

### Phase 3

No new files. Metadata flag changes + test coverage.

## Open Questions

1. **Hook scope:** Can Copilot extensions in `~/.copilot/extensions/` intercept all lifecycle events, or only project-scoped hooks? Needs verification against GA release.
2. **Session state format:** What is the exact file format in `~/.copilot/session-state/`? JSON? One file per session? Needs inspection on a machine with Copilot installed.
3. **Idle detection:** What does Copilot's terminal output look like when idle? Need to characterize the TUI for fallback polling.
4. **`--resume` flag format:** Does `--resume` take a session ID string, a file path, or an index? Needs verification.
5. **Cursor behavior:** Does Copilot hide the terminal cursor during operation? Affects `hidesTerminalCursor` metadata.
