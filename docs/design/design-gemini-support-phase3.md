# Gemini CLI Support — Phase 3 Design

## Status

- **WP0**: **Verified** — Gemini CLI v0.35.3; `--output-format json` still emits text for `--list-sessions` → JSON parser deferred; 8 hook events confirmed
- **WP1**: **Implemented** (commit `88d2769`) — Gemini task queue enablement
- **WP2**: **Implemented** (commit `88d2769`) — Resume parser hardening (validation-only; JSON parser not needed per WP0)
- **WP3**: **Implemented** — Bridge script existence check + stale hook detection logging

Current: 42 test files, 568 tests passing + integration test suite `gemini-task-queue.test.ts` added

## Overview

Phase 3 focuses on two goals:

1. **Task queue enablement** — the single biggest functional gap between Gemini and Claude, now architecturally unblocked by live hooks
2. **Resume parser hardening** — the highest durability risk in the current Gemini integration

A minor third goal is hook bridge cleanup hardening for crash resilience.

Phase 3 does not add new UI surface for Gemini-specific launch options (sandbox, approval-mode, yolo) or account-profile isolation. Those remain deferred pending product decisions.

## Prerequisites

Phase 1, Phase 2, and post-Phase 2 hook integration are complete:

- Gemini sessions get `hookMode='live'` when the bridge is ready
- Agent runtime adapters handle all per-agent logic (`prepareCreate`, `afterCreate`, `prepareResume`, `pollState`)
- Shared capability helpers (`canSessionQueueTasks`, `canSessionBeTaskTarget`) gate on `supportsTaskQueue && hookMode === 'live'`
- 42 test files, 568 tests passing

## WP0: CLI Preflight Verification

Before implementation, reverify against the currently installed Gemini CLI.

### Checks

1. `gemini --version` — record the version
2. `gemini --list-sessions --output-format json` — check if structured JSON output is now available
3. `gemini --help` — verify `--model`, `--resume`, `--list-sessions` flags still exist
4. Verify hook event names by running a Gemini session with the bridge active and inspecting the events that arrive at the hook server. Confirm the 8 registered events still fire with the expected Gemini-native names: `SessionStart`, `SessionEnd`, `BeforeTool`, `AfterTool`, `AfterAgent`, `BeforeAgent`, `Notification`, `BeforeModel`

### Decision Gates

- If `--output-format json` now works: WP2 adds a structured JSON parser as primary, text parser as fallback
- If `--output-format json` still emits text: WP2 adds defensive validation only, no JSON parser
- If hook event names changed: update `GEMINI_EVENT_MAP` in `hook-server.ts` and the `GEMINI_BRIDGE_EVENTS` list in `gemini-hook-config.ts` before proceeding

## WP1: Gemini Task Queue Enablement ✅

### Problem

Gemini sessions cannot be task targets. The task queue system requires `supportsTaskQueue: true` in agent metadata and `hookMode === 'live'`, plus the `TaskQueue.create()` method explicitly rejects non-Claude session types at `src/main/task-queue.ts:213`.

### Changes Required

#### 1. Agent metadata flags

**File:** `src/shared/session-agents.ts`

Add `supportsPlanMode` to `AgentDefinition` and set flags for Gemini:

```typescript
export interface AgentDefinition {
  // ... existing fields ...
  supportsPlanMode: boolean;
}
```

```typescript
claude: {
  // ...
  supportsTaskQueue: true,
  supportsPlanMode: true,   // new — Claude supports plan-mode tasks
  // ...
},
codex: {
  // ...
  supportsTaskQueue: false,
  supportsPlanMode: false,  // new
  // ...
},
gemini: {
  // ...
  supportsTaskQueue: true,  // was false
  supportsPlanMode: false,  // new — Gemini has no plan-mode concept
  // ...
},
```

Setting `supportsTaskQueue: true` makes `canSessionQueueTasks()` and `canSessionBeTaskTarget()` return true for Gemini sessions in live mode. Sessions in fallback mode remain excluded because the capability helpers gate on `hookMode === 'live'`.

The `supportsPlanMode` flag replaces hardcoded `sessionType === 'claude'` checks in task queue plan-mode paths (changes 5 and 6 below), keeping the capability-check pattern consistent across all agent-specific guards.

#### 2. Export `hasLiveTaskQueue` and widen the session-type guard in TaskQueue.create()

**File:** `src/shared/session-capabilities.ts`

Export the existing private helper `hasLiveTaskQueue`:

```typescript
export function hasLiveTaskQueue(session: TaskSessionLike): session is NonNullable<TaskSessionLike> {
  return !!session
    && (getAgentDefinition(session.sessionType)?.supportsTaskQueue ?? false)
    && session.hookMode === 'live';
}
```

**Why not `canSessionBeTaskTarget`?** `canSessionBeTaskTarget` gates on `status === 'active' || status === 'idle'`, which rejects ended sessions before they reach the resume logic at line 236. The `create()` method intentionally allows ended (and waiting/starting) sessions through the type/hookMode checks so they can be queued against or resumed. `hasLiveTaskQueue` checks only agent support + hook mode, without a status constraint.

**File:** `src/main/task-queue.ts` (lines 213-218)

Current code:

```typescript
if (session.sessionType !== 'claude') {
  throw new Error('Task queue only supports Claude sessions as targets');
}
if (session.hookMode !== 'live') {
  throw new Error('Target session must be in live hook mode');
}
```

Replace both checks with:

```typescript
if (!hasLiveTaskQueue(session)) {
  throw new Error('Target session does not support task queue (requires live hook mode and a supported agent type)');
}
```

This subsumes both the session-type check (line 213) and the `hookMode !== 'live'` check (line 216) since `hasLiveTaskQueue` gates on both.

#### 3. Widen the ended-session resume guard

**File:** `src/main/task-queue.ts` (line 240)

Current code:

```typescript
if (!session.claudeSessionId) {
  throw new Error('Target session has ended and cannot be resumed (no Claude session ID)');
}
```

This must handle Gemini's resume identity. Replace with a check against the agent's `resumeIdentityKind`:

```typescript
const agentDef = getAgentDefinition(session.sessionType);
const identityKind = agentDef?.resumeIdentityKind;
if (identityKind && !session[identityKind]) {
  throw new Error(`Target session has ended and cannot be resumed (no ${identityKind})`);
}
```

This works for Claude (`claudeSessionId`), Gemini (`geminiSessionId`), and any future agent.

#### 4. Remove permission-mode cycling for non-Claude agents

**File:** `src/main/task-queue.ts` (lines 220-234)

Permission-mode cycling relies on Shift+Tab behavior that is Claude-specific. Gemini does not support permission modes. The `permissionMode` field in `CreateTaskInput` should be rejected when targeting a Gemini session:

```typescript
if (input.permissionMode && session.sessionType !== 'claude') {
  throw new Error('Permission mode cycling is only supported for Claude sessions');
}
```

This goes before the existing `buildModeCycle` validation block (line 220).

#### 5. Skip plan-mode completion detection for agents that don't support it

**File:** `src/main/task-queue.ts` (lines 799-806)

The plan-mode completion path calls `isAtUserChoice(buffer)`, which checks for Claude-specific plan mode prompts. For agents without plan-mode support, this path should not trigger:

```typescript
if (session.status === 'waiting' && state.hasStarted && row.plan_mode_action) {
  const agentDef = getAgentDefinition(session.sessionType);
  if (agentDef?.supportsPlanMode) {
    const buffer = this.ptyManager.getReplayData(session.sessionId);
    if (buffer && isAtUserChoice(buffer.slice(-500))) {
      state.completedViaIdle = true;
      this.completeTask(taskId);
      return;
    }
  }
}
```

Note: `planModeAction` creation should also be guarded in `TaskQueue.create()` to reject plan-mode tasks targeting agents without support.

#### 6. Reject plan-mode tasks for agents that don't support it

**File:** `src/main/task-queue.ts`, inside the `create()` method, after the session-type validation

```typescript
const agentDef = getAgentDefinition(session.sessionType);
if (input.planModeAction && !agentDef?.supportsPlanMode) {
  throw new Error('Plan mode tasks are only supported for agents with plan-mode capability');
}
```

### What Does Not Change

- `dispatchToExistingSession()` — session-type agnostic; writes prompt to PTY and watches for idle
- `dispatchNewSession()` — creates a session via `sessionManager.create()` which already dispatches to the correct adapter
- `handleSessionUpdate()` — completion detection via active->idle transition is agent-agnostic
- `checkDispatchedForPrompt()` — fallback polling is agent-agnostic
- Capability helpers — already correct, just need `supportsTaskQueue: true`
- Renderer `CreateTaskDialog` and `TerminalToolbar` — already use capability helpers, will automatically show Gemini sessions

### Behavioral Result

- Gemini sessions with `hookMode='live'` appear as task targets in the UI
- Tasks can be queued against Gemini sessions and dispatch via PTY prompt writing
- Task completion is detected when Gemini goes idle (500ms debounced) via hooks or fallback polling
- Permission-mode cycling and plan-mode tasks are rejected for Gemini
- Gemini sessions in fallback mode remain excluded from task queue

## WP2: Resume Parser Hardening ✅

### Problem

`parseGeminiSessionList()` parses the human-readable output of `gemini --list-sessions`. A Gemini CLI update that changes the output format would silently break resume. The parser has no way to signal "I received output but couldn't make sense of it."

### Changes Required

#### 1. Format-expectation validation

**File:** `src/main/session/gemini-session-store.ts`

Add a post-parse validation to `parseGeminiSessionList()`:

```typescript
export function parseGeminiSessionList(output: string): GeminiListedSession[] {
  const lines = output.split('\n');
  const entries: GeminiListedSession[] = [];
  let nonEmptyLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    nonEmptyLines++;

    const match = trimmed.match(SESSION_LINE_RE);
    if (!match) continue;
    // ... existing parse logic ...
  }

  // Warn if we saw non-empty lines but parsed nothing — likely a format change
  if (nonEmptyLines > 0 && entries.length === 0) {
    logger.warn('gemini-session-store', 'Gemini --list-sessions output had content but no parseable sessions', {
      nonEmptyLines,
      firstLine: lines.find((l) => l.trim())?.slice(0, 120),
    });
  }

  return entries;
}
```

This does not change behavior — it adds observability for silent failures.

#### 2. Conditional JSON parser (if WP0 confirms json works)

**Important:** The JSON path is gated by WP0's decision. If WP0 confirms `--output-format json` works, implement the JSON parser as the **primary path** and remove the text parser call from `listGeminiSessions()`. If WP0 confirms it does NOT work, skip this change entirely — do NOT implement a runtime try-catch fallback that spawns two `execFileSync` calls in sequence, as that adds 5+ seconds of blocking latency on every resume when the JSON path fails.

**If WP0 confirms JSON works:**

**File:** `src/main/session/gemini-session-store.ts`

```typescript
export function parseGeminiSessionListJson(output: string): GeminiListedSession[] | null {
  try {
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((entry: unknown, i: number) => {
        if (typeof entry !== 'object' || entry === null) return null;
        const e = entry as Record<string, unknown>;
        const id = typeof e.id === 'string' ? e.id : null;
        const title = typeof e.title === 'string' ? e.title : '';
        if (!id) return null;
        return { index: i + 1, title, relativeAgeText: null, geminiSessionId: id };
      })
      .filter((e): e is GeminiListedSession => e !== null);
  } catch {
    return null; // Not valid JSON — fall back to text parser
  }
}
```

And update `listGeminiSessions()` to use JSON as primary with text as in-process fallback (no second exec):

**File:** `src/main/session/agent-runtimes/gemini-runtime.ts`

```typescript
export function listGeminiSessions(command: string, cwd: string): GeminiListedSession[] {
  const output = execFileSync(command, ['--list-sessions', '--output-format', 'json'], {
    cwd, timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Try JSON parse first; if the CLI returned text despite --output-format json, fall back
  const jsonParsed = parseGeminiSessionListJson(output);
  if (jsonParsed !== null) return jsonParsed;
  return parseGeminiSessionList(output);
}
```

This uses a single `execFileSync` call. If the CLI honours `--output-format json`, the JSON parser succeeds. If the flag is silently ignored and text is returned, `parseGeminiSessionListJson` returns null and the text parser handles the same output.

**If WP0 confirms JSON does NOT work:** Skip this change entirely and ship only the format-expectation validation from change 1.

#### 3. Resume error message improvement

**File:** `src/main/session/agent-runtimes/gemini-runtime.ts`

In `buildGeminiResumePlan()`, improve the "no longer available" error to include diagnostic info:

```typescript
if (resumeIndex === null) {
  const availableIds = entries.map((e) => e.geminiSessionId).join(', ');
  throw new Error(
    `Gemini session ${geminiSessionId} is no longer available in the session list. ` +
    `Found ${entries.length} session(s)${entries.length > 0 ? `: ${availableIds}` : ''}.`,
  );
}
```

### What Does Not Change

- `selectGeminiSessionCandidate()` — selection logic is adequate for current behavior
- `resolveGeminiResumeIndex()` — straightforward lookup, no changes needed
- The text parser regex — the format hasn't changed; hardening is about detecting when it does

## WP3: Hook Bridge Cleanup Hardening ✅

### Problem

`reconcileGeminiHooks()` on startup does a full replace (remove + merge), so stale entries from a prior crash are already cleaned on the next launch. However, the current `reconcileGeminiHooks` does not validate that the bridge script itself exists before registering hooks.

### Changes Required

#### 1. Validate bridge script before reconcile

**File:** `src/main/hooks/gemini-hook-config.ts`

In `reconcileGeminiHooks()`, verify the bridge script was written before proceeding:

```typescript
export function reconcileGeminiHooks(): void {
  const bridgePath = getBridgeScriptPath();
  if (!existsSync(bridgePath)) {
    logger.warn('gemini-hook-config', 'Bridge script not found, skipping reconcile', { path: bridgePath });
    return;
  }
  // ... existing reconcile logic ...
}
```

This is a safety net for the case where `writeGeminiBridgeScript()` fails silently.

#### 2. Log stale entry detection during reconcile

The existing `reconcileGeminiHooks()` already removes and re-adds entries, so stale entries are implicitly cleaned. Add a log line to make this visible:

**File:** `src/main/hooks/gemini-hook-config.ts`

After the `removeMcodeBridgeHooks` call inside `mergeMcodeBridgeHooks`, check if any were removed:

```typescript
export function mergeMcodeBridgeHooks(config: GeminiSettingsConfig): GeminiSettingsConfig {
  const cleaned = removeMcodeBridgeHooks(config);
  const hadExisting = JSON.stringify(cleaned.hooks) !== JSON.stringify(config.hooks);
  if (hadExisting) {
    logger.info('gemini-hook-config', 'Removed stale mcode bridge hooks before re-registering');
  }
  // ... rest of existing merge logic ...
}
```

### Scope Limit

The original Phase 3 proposal mentioned "remove entries pointing to dead `MCODE_HOOK_PORT` endpoints." On closer analysis, this is unnecessary:

- Bridge hooks don't encode a specific port — the `MCODE_HOOK_PORT` env var is set per-session at spawn time
- `reconcileGeminiHooks()` already does a full replace on every startup
- The bridge script itself exits silently when `MCODE_HOOK_PORT` is unset

The real crash-resilience scenario (stale entries left in `~/.gemini/settings.json`) is already handled by the startup reconcile. WP3 adds observability (logging) and a safety check (bridge script existence), not a new cleanup mechanism.

## Test Plan

### WP1: Task Queue Tests ✅

#### Unit tests (implemented)

**File:** `tests/unit/shared/session-capabilities.test.ts` (extended)

- `hasLiveTaskQueue` returns true for live Gemini sessions
- `hasLiveTaskQueue` returns false for fallback Gemini sessions
- `hasLiveTaskQueue` does not gate on session status (critical for ended-session resume)
- `canSessionQueueTasks` and `canSessionBeTaskTarget` work for live Gemini sessions
- `supportsTaskQueue` flags correct per agent (claude=true, codex=false, gemini=true)
- `supportsPlanMode` flags correct per agent (claude=true, codex=false, gemini=false)

#### Integration tests (pending)

**File:** `tests/suites/gemini-task-queue.test.ts` (new, not yet created)

Uses the existing Gemini fixture script (`tests/fixtures/gemini`) via `createGeminiTestSession()` from `tests/helpers.ts`, following the same pattern as `gemini-support.test.ts` and `gemini-resume.test.ts`. No real Gemini CLI required.

Note: The fixture creates sessions with `hookMode='fallback'` since it cannot run the live hook bridge. To test the `hookMode='live'` path in integration tests, either:
- Patch the session's `hookMode` to `'live'` in the DB after creation (test-only workaround), or
- Assert the task queue rejects fallback-mode Gemini sessions and separately assert via unit tests that `hasLiveTaskQueue` returns true for `hookMode='live'` Gemini sessions

Test cases:
- Create a Gemini session via MCP → verify `hasLiveTaskQueue` returns true when `hookMode='live'` (unit-level assertion)
- Create a task targeting a Gemini session → verify task dispatches when session is idle
- Verify task completes when Gemini session returns to idle after dispatch
- Verify permission-mode task creation is rejected for Gemini targets
- Verify plan-mode task creation is rejected for Gemini targets

### WP2: Resume Parser Tests ✅

#### Unit tests (implemented)

**File:** `tests/unit/main/gemini-session-store.test.ts` (extended)

- `parseGeminiSessionList()` logs warning when output has content but no parseable sessions
- `parseGeminiSessionList()` does not warn on empty output
- `parseGeminiSessionList()` does not warn when sessions are successfully parsed
- `parseGeminiSessionListJson()` tests deferred pending WP0 JSON decision

**File:** `tests/unit/main/gemini-runtime.test.ts` (extended)

- `buildGeminiResumePlan()` error message includes available session IDs when stored ID not found
- `buildGeminiResumePlan()` shows zero-session message when list is empty

### WP3: Hook Cleanup Tests (pending)

**File:** `tests/unit/main/gemini-hook-config.test.ts` (extend existing)

- `reconcileGeminiHooks()` skips reconcile when bridge script doesn't exist
- `mergeMcodeBridgeHooks()` logs when removing stale entries

## Verification

### WP1+WP2 (completed)

1. `npm test` — 42 files, 568 tests passing (1 pre-existing failure unrelated to Phase 3)
2. TypeScript compiles clean (`npx tsc --noEmit`)
3. Remaining manual verification:
   - Create a Gemini session in the UI → confirm task queue button appears in toolbar
   - Queue a task against the Gemini session → confirm it dispatches and completes
   - Attempt to create a permission-mode task for Gemini → confirm rejection
   - Resume a Gemini session → confirm resume works and error messages are improved

### WP3 (pending)

1. Focused MCP validation: `npm run test:mcp -- tests/suites/gemini-support.test.ts tests/suites/gemini-resume.test.ts`
2. Integration test suite for Gemini task queue (pending WP0 + manual testing)

## Implementation Order

1. ~~WP0 — CLI verification (no code changes, informs WP2 scope)~~ — pending
2. ~~WP1 — task queue enablement (largest scope, most value)~~ — **done** (`88d2769`)
3. ~~WP2 — resume parser hardening (independent of WP1)~~ — **done** (`88d2769`, validation-only; JSON parser deferred to WP0)
4. WP3 — hook cleanup hardening (smallest scope, can be done last)

WP0 still gates the JSON parser decision in WP2. If WP0 confirms JSON works, add `parseGeminiSessionListJson()` and update `listGeminiSessions()` per the WP2 change 2 design above.

## Files Modified

| File | WP | Change |
|------|----|--------|
| `src/shared/session-agents.ts` | WP1 | `supportsTaskQueue: true` for Gemini, add `supportsPlanMode` to `AgentDefinition` |
| `src/shared/session-capabilities.ts` | WP1 | Export `hasLiveTaskQueue` |
| `src/main/task-queue.ts` | WP1 | Replace session-type + hookMode guards with `hasLiveTaskQueue`, widen resume guard, use `supportsPlanMode` for plan-mode guards, reject permission mode for non-Claude |
| `src/main/session/gemini-session-store.ts` | WP2 | Format-expectation logging, optional JSON parser |
| `src/main/session/agent-runtimes/gemini-runtime.ts` | WP2 | Improved resume error messages, optional JSON-first listing |
| `src/main/hooks/gemini-hook-config.ts` | WP3 | Bridge script existence check, stale entry logging |
| `tests/unit/main/task-queue.test.ts` | WP1 | Gemini target acceptance/rejection tests |
| `tests/suites/gemini-task-queue.test.ts` | WP1 | New integration suite |
| `tests/unit/main/gemini-session-store.test.ts` | WP2 | Format-expectation and JSON parser tests |
| `tests/unit/main/gemini-runtime.test.ts` | WP2 | Improved error message tests |
| `tests/unit/main/gemini-hook-config.test.ts` | WP3 | Cleanup hardening tests |

## Explicitly Not In Phase 3

- Sandbox, approval-mode, and yolo UI — require product decisions about presentation
- Account-profile isolation — significant scope; Gemini's account model needs investigation
- Gemini-specific persistence shapes — no user-facing value until task queue is proven
- Codex task queue enablement — same pattern as Gemini; can follow once Gemini proves the path
- Permission-mode support for Gemini — depends on Gemini CLI supporting the concept
