# Gemini CLI Support — Phase 3 Design

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
- 39 test files, 515 tests passing

## WP0: CLI Preflight Verification

Before implementation, reverify against the currently installed Gemini CLI.

### Checks

1. `gemini --version` — record the version
2. `gemini --list-sessions --output-format json` — check if structured JSON output is now available
3. `gemini --help` — verify `--model`, `--resume`, `--list-sessions` flags still exist
4. Verify hook event names by running a Gemini session with the bridge active and inspecting the events that arrive at the hook server. Confirm the 7 registered events still fire with the expected Gemini-native names: `SessionStart`, `SessionEnd`, `BeforeTool`, `AfterTool`, `AfterAgent`, `BeforeAgent`, `Notification`

### Decision Gates

- If `--output-format json` now works: WP2 adds a structured JSON parser as primary, text parser as fallback
- If `--output-format json` still emits text: WP2 adds defensive validation only, no JSON parser
- If hook event names changed: update `GEMINI_EVENT_MAP` in `hook-server.ts` and the `GEMINI_BRIDGE_EVENTS` list in `gemini-hook-config.ts` before proceeding

## WP1: Gemini Task Queue Enablement

### Problem

Gemini sessions cannot be task targets. The task queue system requires `supportsTaskQueue: true` in agent metadata and `hookMode === 'live'`, plus the `TaskQueue.create()` method explicitly rejects non-Claude session types at `src/main/task-queue.ts:213`.

### Changes Required

#### 1. Agent metadata flag

**File:** `src/shared/session-agents.ts`

Set `supportsTaskQueue: true` for Gemini:

```typescript
gemini: {
  // ...
  supportsTaskQueue: true,  // was false
  // ...
},
```

This alone makes `canSessionQueueTasks()` and `canSessionBeTaskTarget()` return true for Gemini sessions in live mode. Sessions in fallback mode remain excluded because the capability helpers gate on `hookMode === 'live'`.

#### 2. Widen the session-type guard in TaskQueue.create()

**File:** `src/main/task-queue.ts` (line 213)

Current code:

```typescript
if (session.sessionType !== 'claude') {
  throw new Error('Task queue only supports Claude sessions as targets');
}
```

Replace with a capability check:

```typescript
if (!canSessionBeTaskTarget(session)) {
  throw new Error('Target session does not support task queue (requires live hook mode and a supported agent type)');
}
```

This subsumes the existing `hookMode !== 'live'` check at line 216 since `canSessionBeTaskTarget` already gates on hook mode.

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

#### 5. Skip plan-mode completion detection for non-Claude agents

**File:** `src/main/task-queue.ts` (lines 799-806)

The plan-mode completion path calls `isAtUserChoice(buffer)`, which checks for Claude-specific plan mode prompts. For Gemini tasks, this path should not trigger:

```typescript
if (session.status === 'waiting' && state.hasStarted && row.plan_mode_action) {
  // Plan mode is Claude-only; skip for other agents
  if (session.sessionType === 'claude') {
    const buffer = this.ptyManager.getReplayData(session.sessionId);
    if (buffer && isAtUserChoice(buffer.slice(-500))) {
      state.completedViaIdle = true;
      this.completeTask(taskId);
      return;
    }
  }
}
```

Note: `planModeAction` creation should also be guarded in `TaskQueue.create()` to reject plan-mode tasks targeting non-Claude sessions.

#### 6. Reject plan-mode tasks for non-Claude targets

**File:** `src/main/task-queue.ts`, inside the `create()` method, after the session-type validation

```typescript
if (input.planModeAction && session.sessionType !== 'claude') {
  throw new Error('Plan mode tasks are only supported for Claude sessions');
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

## WP2: Resume Parser Hardening

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

If `--output-format json` now produces usable structured output, add a dual-path parser:

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

And update `listGeminiSessions()` to try JSON first:

**File:** `src/main/session/agent-runtimes/gemini-runtime.ts`

```typescript
export function listGeminiSessions(command: string, cwd: string): GeminiListedSession[] {
  // Try structured JSON output first
  try {
    const jsonOutput = execFileSync(command, ['--list-sessions', '--output-format', 'json'], {
      cwd, timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const jsonParsed = parseGeminiSessionListJson(jsonOutput);
    if (jsonParsed !== null && jsonParsed.length > 0) return jsonParsed;
  } catch { /* fall through */ }

  // Fall back to text parsing
  const output = execFileSync(command, ['--list-sessions'], {
    cwd, timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return parseGeminiSessionList(output);
}
```

**Decision:** Only implement the JSON path if WP0 confirms it works. If not, skip this and ship only the format-expectation validation.

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

## WP3: Hook Bridge Cleanup Hardening

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

### WP1: Task Queue Tests

#### Unit tests

**File:** `tests/unit/main/task-queue.test.ts` (extend existing)

- `create()` accepts Gemini sessions with `hookMode='live'` as targets
- `create()` rejects Gemini sessions with `hookMode='fallback'` as targets
- `create()` rejects `permissionMode` when targeting Gemini sessions
- `create()` rejects `planModeAction` when targeting Gemini sessions
- `create()` resumes ended Gemini sessions when `geminiSessionId` is present
- `create()` rejects ended Gemini sessions when `geminiSessionId` is missing

#### Integration tests

**File:** `tests/suites/gemini-task-queue.test.ts` (new)

- Create a Gemini session via MCP → verify `canSessionBeTaskTarget` returns true when `hookMode='live'`
- Create a task targeting a Gemini session → verify task dispatches when session is idle
- Verify task completes when Gemini session returns to idle after dispatch
- Verify permission-mode task creation is rejected for Gemini targets
- Verify plan-mode task creation is rejected for Gemini targets

### WP2: Resume Parser Tests

#### Unit tests

**File:** `tests/unit/main/gemini-session-store.test.ts` (extend existing)

- `parseGeminiSessionList()` logs warning when output has content but no parseable sessions
- `parseGeminiSessionListJson()` returns valid entries from well-formed JSON (if implemented)
- `parseGeminiSessionListJson()` returns null from non-JSON input (if implemented)
- `parseGeminiSessionListJson()` returns null from JSON that is not an array (if implemented)

**File:** `tests/unit/main/gemini-runtime.test.ts` (extend existing)

- `buildGeminiResumePlan()` error message includes available session IDs when stored ID not found

### WP3: Hook Cleanup Tests

**File:** `tests/unit/main/gemini-hook-config.test.ts` (extend existing)

- `reconcileGeminiHooks()` skips reconcile when bridge script doesn't exist
- `mergeMcodeBridgeHooks()` logs when removing stale entries

## Verification

After implementation:

1. `npm test` — all unit tests pass (target: 39+ files, 530+ tests)
2. Focused MCP validation against a fresh dev instance:
   - `npm run test:mcp -- tests/suites/gemini-task-queue.test.ts tests/suites/gemini-support.test.ts tests/suites/gemini-resume.test.ts`
3. Manual verification:
   - Create a Gemini session in the UI → confirm task queue button appears in toolbar
   - Queue a task against the Gemini session → confirm it dispatches and completes
   - Attempt to create a permission-mode task for Gemini → confirm rejection
   - Resume a Gemini session → confirm resume works and error messages are improved

## Implementation Order

1. WP0 — CLI verification (no code changes, informs WP2 scope)
2. WP1 — task queue enablement (largest scope, most value)
3. WP2 — resume parser hardening (independent of WP1)
4. WP3 — hook cleanup hardening (smallest scope, can be done last)

WP1 and WP2 are independent and can be implemented in parallel.

## Files Modified

| File | WP | Change |
|------|----|--------|
| `src/shared/session-agents.ts` | WP1 | `supportsTaskQueue: true` |
| `src/main/task-queue.ts` | WP1 | Widen session-type guard, resume guard, reject permission/plan mode for non-Claude |
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
