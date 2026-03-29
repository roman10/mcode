# Copilot CLI Support — Phase 3 Design

## Status

| WP | Description | Dependencies | Status |
|----|-------------|-------------|--------|
| 3A | Task queue enablement (metadata flag + integration tests) | Phase 2 complete | **✅ Complete** |
| 3B | Commit tracking verification | Phase 1 R1 refactor | **✅ Complete** (already implemented in Phase 1) |
| 3C | Polish (cursor, idle detection, edge cases) | Phase 2 complete | **✅ Complete** (factory fix applied; remaining items are verification-only) |

## Overview

Phase 3 is the final phase of Copilot CLI support. It enables the task queue, verifies commit tracking, and production-hardens the integration. No new architectural patterns are needed — the task queue infrastructure is fully generic (proven with Claude and Gemini), and all Copilot-specific hook/resume plumbing shipped in Phase 2.

**Key insight:** Gemini's Phase 3 required generalizing several hardcoded guards in `task-queue.ts` (replacing `sessionType === 'claude'` checks with capability helpers). That work is already done — Copilot benefits from it directly. Enabling Copilot task queue is a one-line metadata change plus test coverage.

### Prerequisites

Phase 2 delivered:
- Hook bridge with `hookMode='live'` for real-time state tracking
- Resume via `copilot --resume <UUID>`
- Hook-based session-ID capture from `sessionStart` payloads
- 652 tests passing

---

## Phase 3A: Task Queue Enablement

**Goal:** Copilot sessions with `hookMode='live'` become valid task targets.

### Code change

**File: `src/shared/session-agents.ts`** — one line:

```typescript
copilot: {
  // ...
  supportsTaskQueue: true,   // was: false
  // ...
}
```

### Why this is sufficient

The task queue's capability gates are already generic (generalized during Gemini Phase 3):

| Guard | Location | Generic? |
|-------|----------|----------|
| `hasLiveTaskQueue(session)` | `session-capabilities.ts:8` | Yes — checks `supportsTaskQueue && hookMode === 'live'` |
| `canSessionQueueTasks(session)` | `session-capabilities.ts:14` | Yes — adds `status !== 'ended'` |
| `canSessionBeTaskTarget(session)` | `session-capabilities.ts:22` | Yes — requires `active \|\| idle` |
| Permission mode rejection | `task-queue.ts:221` | Yes — `sessionType !== 'claude'` (correct, only Claude has permission modes) |
| Plan mode rejection | `task-queue.ts:226` | Yes — `!agentDef?.supportsPlanMode` (Copilot: `false`) |
| Plan mode completion detection | `task-queue.ts:812` | Yes — `agentDef?.supportsPlanMode` guard |

No changes needed in `task-queue.ts`, `session-capabilities.ts`, or any renderer code. The existing generic helpers automatically include Copilot once `supportsTaskQueue` is `true`.

### Task dispatch flow (verification)

The task dispatch mechanism writes raw prompts to the PTY:

```
ptyManager.write(sessionId, prompt + '\r')
```

This works identically for all agents. Copilot interprets `\r` as Enter (prompt submission) — same as Claude and Gemini. No agent-specific dispatch logic needed.

### Task completion detection

**Key difference from Claude/Gemini:** Copilot has no hook event that maps to the canonical `Stop` event. Claude has a native `Stop` event, and Gemini has `AfterAgent → Stop`. Copilot's six events (`sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `userPromptSubmitted`, `errorOccurred`) cover activity detection and session lifecycle, but none signals "agent finished responding, awaiting input."

This means the `active → idle` transition for live Copilot sessions relies on **quiescence polling** (`copilotPollState`), not a hook event:

1. Task dispatched → PTY write → session transitions to `active` (via `PreToolUse`/`PostToolUse` hook events)
2. Copilot finishes responding → hook events stop flowing
3. Quiescence polling detects 5s of no PTY output (`PTY_QUIESCENCE_MS = 5000`) → `copilotPollState` returns `{ status: 'idle' }`
4. Task queue detects `idle` → marks task as `completed`

**Latency impact:** ~5s delay for task completion detection (`PTY_QUIESCENCE_MS = 5000`) vs near-instant for Claude/Gemini (which have a `Stop` hook event). This is acceptable for queued tasks — the same quiescence mechanism already works reliably for all agents as a polling backup. The only difference is that Copilot relies on it as the primary active→idle path even in live mode.

**Session end** is still hook-based: `sessionEnd → SessionEnd → ended`. Any pending tasks are failed immediately via the hook event, not polling.

**Why `hookMode='live'` is still correct:** `pollSessionStates()` (`session-manager.ts:1193`) runs for ALL non-terminal sessions regardless of hookMode — there is no hookMode filter in the query. Polling always runs as a safety net. `hookMode='live'` means hooks are active and provide real-time events (SessionStart→active, PreToolUse→active, SessionEnd→ended). The active→idle transition via polling is a supplement, not a contradiction.

**Future improvement:** If Copilot CLI adds an agent-completion hook event (analogous to Gemini's `AfterAgent`), the `COPILOT_EVENT_MAP` can map it to `Stop` for instant active→idle transition. No other changes needed — the state machine already handles `Stop`.

### What Copilot task queue does NOT support

- **Permission mode cycling** — Copilot has no equivalent of Claude's `Shift+Tab` permission mode toggle. Tasks with `permissionMode` are rejected (existing guard: `sessionType !== 'claude'`).
- **Plan mode tasks** — Copilot has no plan mode integration. Tasks with `planModeAction` are rejected (existing guard: `!agentDef?.supportsPlanMode`).

---

## Phase 3B: Commit Tracking Verification

**Goal:** Verify that Copilot-authored commits are correctly detected as AI-assisted.

### Current state

The R1 refactor was applied in Phase 1 (`commit 573e0ba`):

```typescript
// src/main/trackers/commit-tracker.ts
const AI_COAUTHOR_PATTERNS = ['claude', 'anthropic', 'codex', 'openai', 'copilot'];
```

Copilot commits use the trailer format:
```
Co-Authored-By: GitHub Copilot <noreply@github.com>
```

The pattern `'copilot'` matches `"github copilot"` (case-insensitive). Unit tests for this already exist in `tests/unit/main/commit-tracker.test.ts`.

### Verification

- Create a commit with `Co-Authored-By: GitHub Copilot <noreply@github.com>` trailer
- Verify `detectAIAssisted()` returns `true`
- Verify the commit appears as AI-assisted in the commit tracker UI

No code changes needed — this is a verification-only work package.

---

## Phase 3C: Polish

### C1: Cursor hiding verification

**Current state:** `hidesTerminalCursor: true` set as conservative default in Phase 1.

**Action:** Verify via PTY escape sequence inspection whether Copilot CLI actually hides the cursor (sends `\x1b[?25l`). If it does not, flip to `false` so the terminal cursor remains visible during Copilot sessions. Either way, this is cosmetic — the current default is harmless.

### C2: Idle detection accuracy

**Current state:** `copilotPollState()` uses 5s quiescence (`PTY_QUIESCENCE_MS = 5000`, same as Codex/Gemini). Phase 2 hook bridge provides real-time state for live sessions.

**Action:** Verify with a real Copilot CLI session that:
- Hook-based transitions (`SessionStart` → active, quiescence → idle) are accurate
- Fallback polling correctly detects idle after Copilot finishes a response
- No false positives (premature idle during long responses with pauses)

If quiescence threshold needs tuning, the `isQuiescent` debounce is configurable per-agent.

### C3: Concurrent session-ID capture

**Current state:** Phase 1's filesystem polling (`scheduleCopilotSessionCapture`) matches sessions by cwd + creation time. Phase 2 added hook-based capture (instant, via `sessionId` in hook payloads).

**Action:** Test creating 3+ Copilot sessions rapidly in the same directory. Verify:
- Each session captures the correct UUID (no cross-capture)
- Hook-based capture takes priority when hooks are live
- Filesystem polling fallback handles the concurrent case (unlikely but verify)

### C4: Test factory gap

**Current state:** `makeSession()` in `tests/unit/test-factories.ts` does not include `copilotSessionId` in its defaults. `copilotSessionId: string | null` is a required (non-optional) field on `SessionInfo`. TypeScript doesn't catch the omission because `...overrides: Partial<SessionInfo>` makes it assume the spread *could* contain the field. But `makeSession()` with no overrides produces an object missing `copilotSessionId` at runtime.

**Action:** Add `copilotSessionId: null` to the factory defaults, alongside the existing `claudeSessionId: null`, `codexThreadId: null`, `geminiSessionId: null`.

### C5: Session-end cleanup

**Action:** Verify that when a Copilot session ends (user types `/exit`, Ctrl+C, or session times out):
- `sessionEnd` hook fires with correct `reason` field
- Session transitions to `ended` status
- Any pending tasks targeting the session are marked `failed`
- Resume button appears with correct session ID

---

## Test Plan

### Unit tests

**`tests/unit/shared/session-capabilities.test.ts`** (extend):
- `hasLiveTaskQueue` returns `true` for Copilot session with `hookMode='live'`
- `hasLiveTaskQueue` returns `false` for Copilot session with `hookMode='fallback'`
- `canSessionBeTaskTarget` returns `true` for idle live Copilot session
- Update `supportsTaskQueue` flags test (line 59) to include `copilot: true`
- Update `supportsPlanMode` flags test (line 53) to include `copilot: false`
- Update `canDisplaySessionModel` test (line 46) to include Copilot with model
- Update `installHelpUrl` test (line 65) to include Copilot URL

### Integration tests

**`tests/suites/copilot-task-queue.test.ts`** (new — follows `gemini-task-queue.test.ts` pattern):

```typescript
// Helper: create live idle Copilot session.
// Note: 'Stop' is a synthetic test event injected via the canonical mcode event name.
// In production, Copilot's active→idle transition happens via quiescence polling
// (copilotPollState), not a hook event — Copilot has no Stop-equivalent.
// Using 'Stop' here is correct for testing because injectHookEvent sends directly
// to the session-manager state machine, bypassing the hook event name mapping.
async function createIdleLiveCopilotSession(client: McpTestClient): Promise<SessionInfo> {
  const session = await createCopilotTestSession(client);
  if (session.hookMode !== 'live') {
    throw new Error(`Expected hookMode='live', got '${session.hookMode}'`);
  }
  await injectHookEvent(client, session.sessionId, 'SessionStart');
  return injectHookEvent(client, session.sessionId, 'Stop');
}
```

| Test | Description |
|------|-------------|
| `dispatches a task to a live Copilot session` | Create task → dispatched → inject PreToolUse + Stop → completed |
| `dispatches tasks sequentially on a Copilot session` | Two tasks, first completes before second dispatches |
| `rejects permission-mode tasks for Copilot sessions` | `permissionMode: 'auto'` → throws `/permission mode/i` |
| `rejects plan-mode tasks for Copilot sessions` | `planModeAction` → throws `/plan mode/i` |
| `rejects task targeting a fallback Copilot session` | Session with `command: 'bash'` (forces fallback) → throws `/live hook mode/i` |
| `fails Copilot tasks when session ends` | Dispatch + kill → both tasks fail |

These mirror the Gemini task queue tests exactly, providing equivalent coverage for the Copilot agent type.

**Note on `Stop` injection vs quiescence:** All 6 tests use synthetic `Stop` event injection (via `injectHookEvent`) to transition sessions to idle. In production, Copilot's active→idle transition uses quiescence polling instead (see [Task completion detection](#task-completion-detection)). A dedicated quiescence-based test is not needed because: (a) the task queue doesn't care *how* idle happens — it watches the status column; (b) the quiescence mechanism is already exercised by existing Copilot tests (`copilot-support.test.ts` uses `waitForIdle` which relies on `copilotPollState` + `PTY_QUIESCENCE_MS`); (c) such a test would take 5+ seconds for minimal additional coverage.

---

## Verification Checklist

- [ ] `supportsTaskQueue: true` set in agent definition
- [ ] Create Copilot session with `hookMode='live'` → appears in task target dropdown
- [ ] Queue a task → prompt injected to PTY, task dispatched
- [ ] Simulate completion via hook events → task marked completed
- [ ] Sequential tasks dispatch in order
- [ ] Permission mode task rejected with clear error
- [ ] Plan mode task rejected with clear error
- [ ] Fallback session rejected as task target
- [ ] Tasks fail when session ends
- [ ] Copilot commits detected as AI-assisted
- [ ] `npm test` — all tests pass
- [ ] `npm run test:mcp -- tests/suites/copilot-task-queue.test.ts` — integration pass

---

## File Change Summary

| File | Action | WP | Purpose |
|------|--------|-----|---------|
| `src/shared/session-agents.ts` | Modify | 3A | `supportsTaskQueue: true` |
| `tests/suites/copilot-task-queue.test.ts` | **New** | 3A | Integration tests (6 cases, mirroring Gemini task queue) |
| `tests/unit/shared/session-capabilities.test.ts` | Modify | 3A | Add Copilot cases to capability helper tests |
| `tests/unit/test-factories.ts` | Modify | 3C | Add `copilotSessionId: null` default to `makeSession()` |

Total: 3 modified files, 1 new test file.

No changes to `task-queue.ts`, `session-capabilities.ts`, `copilot-runtime.ts`, or any renderer code. The generic infrastructure already handles Copilot correctly once the metadata flag is set.

---

## Implementation Order

```
3A  supportsTaskQueue flag + tests
 │
 ├─ 3B  commit tracking verification (parallel, no code changes)
 │
 └─ 3C  polish verification (parallel, code changes only if defects found)
```

3A is the only work package with code changes. 3B and 3C are verification-only and can run in parallel with 3A or after.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Copilot ignores `\r` for prompt submission | Very low | High | Same PTY mechanism works for Claude/Gemini; Copilot is a standard PTY app |
| Task completion detected too early (false idle) | Low | Medium | Quiescence polling uses 5000ms debounce (`PTY_QUIESCENCE_MS`); same mechanism proven in fallback mode |
| Task completion latency (~5s) | Certain | Low | No `Stop`-equivalent hook event; quiescence polling (5000ms `PTY_QUIESCENCE_MS`) is only path. Acceptable for queued tasks; same mechanism proven across all agents |
| Concurrent task dispatch race | Very low | Medium | Task queue uses single-threaded dispatch loop with DB-level locking |

---

## Explicitly Not In Phase 3

- **Token/cost tracking** — Copilot is subscription-based; no per-token tracking planned
- **Runtime model detection** — Hook payloads lack model info; deferred until Copilot CLI adds it
- **Plugin packaging** — Copilot's plugin system could bundle mcode's hooks as a distributable plugin; deferred as a convenience feature
- **Account profiles** — Copilot uses GitHub auth; no multi-account use case

---

## Phase 3 Deliverable

Copilot sessions with live hooks can be task targets. The full task lifecycle (queue → dispatch → complete/fail) works identically to Claude and Gemini. Commit tracking is verified. The integration is production-ready.

After Phase 3, Copilot CLI reaches full feature parity with Gemini (task queue, hooks, resume, model display, commit tracking) and near-parity with Claude (missing only permission mode cycling and plan mode, which are Claude-specific features).
