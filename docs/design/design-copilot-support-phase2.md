# Copilot CLI Support — Phase 2 Design

## Overview

Phase 2 delivers hook-based state tracking and session resume for Copilot CLI sessions. After Phase 2, Copilot gains real-time status via hooks, session resume, and instant session-ID capture — reaching feature parity with Codex and Gemini.

Phase 1 shipped the MVP (spawn, display, kill, fallback polling, session-ID capture). Phase 2 builds directly on top of it.

Prerequisite reading: [design-copilot-support.md](./design-copilot-support.md) (overview), [design-copilot-support-phase1.md](./design-copilot-support-phase1.md) (Phase 1 details).

## Work Packages

| WP | Description | Dependencies | Status |
|----|-------------|-------------|--------|
| 2A | Hook bridge (config, bridge script, event mapping, startup registration) | None | **✅ Complete** |
| 2B | Resume (`prepareResume` in adapter) | None | **✅ Complete** |
| 2C | Hook-based session-ID capture from `sessionId` payload field | 2A | **✅ Complete** |
| 2E | Tests | 2A, 2B, 2C | **✅ Complete** |

**Deferred:** Runtime model detection — moved to [Future Enhancements](#future-enhancements) (hook payloads don't contain model info).

---

## Phase 2A: Hook Bridge

**Goal:** Copilot sessions get `hookMode='live'` for real-time state tracking via the mcode hook server.

### Architecture (adapted pattern)

The Codex and Gemini hook bridges follow an identical architecture:

1. **Bridge script** (`~/.mcode/<agent>-hook-bridge.sh`) — a shell script that reads JSON from stdin and forwards it as an HTTP POST to `http://localhost:$MCODE_HOOK_PORT/hook`
2. **Hook config** — agent-specific config file registers the bridge script for all supported events
3. **Startup reconciliation** — mcode writes/merges hooks on startup, removes on quit
4. **Env var** — `MCODE_HOOK_PORT` passed to the child PTY process so the bridge script knows where to POST

Copilot follows this pattern with one key difference: **Copilot's hook payloads do not include a `hook_event_name` field.** The mcode hook server requires this field (see `handleHookPost()` in `hook-server.ts`). The bridge script must inject it using per-event environment variables provided via Copilot's `"env"` field in the hook config.

### Bridge script

**File:** `~/.mcode/copilot-hook-bridge.sh` (written by mcode on startup)

```sh
#!/bin/sh
# mcode Copilot hook bridge — forwards hook events to mcode's HTTP hook server.
# Non-mcode Copilot sessions (no MCODE_HOOK_PORT) exit silently.
[ -z "$MCODE_HOOK_PORT" ] && printf '{}' && exit 0
# Copilot payloads lack hook_event_name — inject it from $COPILOT_HOOK_EVENT
# (set per-event via the "env" field in hooks.json).
INPUT=$(cat)
printf '%s' "$INPUT" | sed 's/^{/{"hook_event_name":"'"$COPILOT_HOOK_EVENT"'",/' | \
curl -sS -o /dev/null "http://localhost:$MCODE_HOOK_PORT/hook" \
  -H "X-Mcode-Session-Id: $MCODE_SESSION_ID" \
  -H 'Content-Type: application/json' -d @- 2>/dev/null || true
printf '{}'
```

**Key differences from Codex/Gemini bridges:**
- Copilot hook payloads do **not** contain `hook_event_name` (unlike Claude/Codex/Gemini which include it). The bridge script injects it using `sed` to prepend the field to the JSON object.
- `$COPILOT_HOOK_EVENT` is set per-event entry in the hook config via the `"env"` field (e.g., `"env": { "COPILOT_HOOK_EVENT": "sessionStart" }`).
- `$MCODE_SESSION_ID` is set by mcode when spawning the PTY. `$MCODE_HOOK_PORT` is the HTTP hook server port (7777–7799).
- Returns `{}` to stdout, which is safe for `preToolUse` hooks (no `permissionDecision` = allow).

### Hook config format

Copilot CLI hooks are configured in a `hooks.json` file. The documented format uses `"bash"` (not `"command"`) for the shell command, `"timeoutSec"` (not `"timeout"`), and supports an `"env"` field for per-entry environment variables.

**File path:** `~/.copilot/hooks/hooks.json` (verified — see [resolved questions](#resolved-questions)). The CLI's `--config-dir` defaults to `~/.copilot`, and hooks placed there are picked up globally regardless of CWD.

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "type": "command", "bash": "~/.mcode/copilot-hook-bridge.sh", "timeoutSec": 10, "env": { "COPILOT_HOOK_EVENT": "sessionStart" } }],
    "sessionEnd": [{ "type": "command", "bash": "~/.mcode/copilot-hook-bridge.sh", "timeoutSec": 10, "env": { "COPILOT_HOOK_EVENT": "sessionEnd" } }],
    "preToolUse": [{ "type": "command", "bash": "~/.mcode/copilot-hook-bridge.sh", "timeoutSec": 10, "env": { "COPILOT_HOOK_EVENT": "preToolUse" } }],
    "postToolUse": [{ "type": "command", "bash": "~/.mcode/copilot-hook-bridge.sh", "timeoutSec": 10, "env": { "COPILOT_HOOK_EVENT": "postToolUse" } }],
    "userPromptSubmitted": [{ "type": "command", "bash": "~/.mcode/copilot-hook-bridge.sh", "timeoutSec": 10, "env": { "COPILOT_HOOK_EVENT": "userPromptSubmitted" } }],
    "errorOccurred": [{ "type": "command", "bash": "~/.mcode/copilot-hook-bridge.sh", "timeoutSec": 10, "env": { "COPILOT_HOOK_EVENT": "errorOccurred" } }]
  }
}
```

Each entry includes `"env": { "COPILOT_HOOK_EVENT": "<eventName>" }` so the bridge script knows which event triggered it (Copilot payloads lack `hook_event_name`).

**Key differences from Codex/Gemini:**
- Uses `"bash"` instead of `"command"` for the shell command path
- Uses `"timeoutSec"` (seconds) instead of `"timeout"` (Codex uses seconds too, but with different key name)
- Supports `"env"` field for injecting per-hook environment variables
- Flat array per event (no `{ matcher, hooks[] }` group wrappers like Gemini/Codex)

### Hook config manager

**New file: `src/main/hooks/copilot-hook-config.ts`**

Follows the exact pattern of `codex-hook-config.ts` and `gemini-hook-config.ts`. Key functions:

```typescript
// Constants
const BRIDGE_SCRIPT_NAME = 'copilot-hook-bridge.sh';

function getCopilotHooksPath(): string {
  return join(homedir(), '.copilot', 'hooks', 'hooks.json');
}

// Copilot hook events to register
const COPILOT_BRIDGE_EVENTS = [
  'sessionStart',
  'sessionEnd',
  'preToolUse',
  'postToolUse',
  'userPromptSubmitted',
  'errorOccurred',
] as const;

// Pure functions
export function removeMcodeBridgeHooks(config: CopilotHooksConfig): CopilotHooksConfig;
export function mergeMcodeBridgeHooks(config: CopilotHooksConfig): CopilotHooksConfig;

// File I/O
export function writeCopilotBridgeScript(): string;
export function reconcileCopilotHooks(): void;
export function cleanupCopilotHooks(): void;
```

**Config structure differences from Codex/Gemini:**

```typescript
interface CopilotHookEntry {
  type: string;           // 'command'
  bash: string;           // shell command (not 'command' key like Codex/Gemini)
  powershell?: string;    // PowerShell alternative (ignored on macOS)
  cwd?: string;           // working directory for script
  timeoutSec?: number;    // timeout in seconds (default: 30)
  env?: Record<string, string>; // per-entry environment variables
  comment?: string;       // optional description
}

interface CopilotHooksConfig {
  version?: number;    // always 1
  hooks?: Record<string, CopilotHookEntry[]>;  // flat array, not grouped
}
```

Unlike Gemini (which uses `{ matcher, hooks[] }` group wrappers) and Codex (which uses `{ hooks[] }` groups), Copilot hooks are flat arrays per event type. Multiple hooks per event execute in order.

**Ownership marker:** Same pattern as Codex/Gemini — any entry whose `bash` field contains `copilot-hook-bridge.sh` is mcode-owned. Merge preserves user entries; only mcode entries are added/removed.

**Backup:** One-time backup before first mutation, same as Gemini.

### Event name mapping

**File: `src/main/hooks/hook-server.ts`**

Copilot uses camelCase event names that differ from mcode's canonical PascalCase. Add a mapping table (same pattern as `GEMINI_EVENT_MAP`):

```typescript
const COPILOT_EVENT_MAP: Record<string, string> = {
  'sessionStart': 'SessionStart',
  'sessionEnd': 'SessionEnd',
  'preToolUse': 'PreToolUse',
  'postToolUse': 'PostToolUse',
  'userPromptSubmitted': 'UserPromptSubmit',
  'errorOccurred': 'Notification',
};
```

Update `normalizeHookEventName()` to check both maps:

```typescript
export function normalizeHookEventName(rawName: string): string {
  return GEMINI_EVENT_MAP[rawName] ?? COPILOT_EVENT_MAP[rawName] ?? rawName;
}
```

**Mapping notes:**
- `userPromptSubmitted` → `UserPromptSubmit` (Copilot's past tense → mcode's convention)
- `errorOccurred` → `Notification` (safe catch-all; `PostToolUseFailure` would be semantically wrong — per GitHub docs, `errorOccurred` fires for general errors like network timeouts and auth failures, not just tool failures)
- Other events map trivially via case change

### Payload field normalization

Copilot payloads use camelCase field names that differ from mcode's snake_case conventions (inherited from Claude):

| mcode field (hook-server.ts) | Copilot payload field | Notes |
|----|----|-----|
| `hook_event_name` | *(absent)* | Injected by bridge script via `$COPILOT_HOOK_EVENT` |
| `tool_name` | `toolName` | Same semantics, different casing |
| `tool_input` | `toolArgs` | JSON string in `preToolUse`, object in `postToolUse` — handle both |
| `session_id` | `sessionId` | UUID, present in all events (undocumented but verified) |

**Implementation:** Update `handleHookPost()` in `hook-server.ts` to also check camelCase field names:

```typescript
toolName: (body.tool_name as string) ?? (body.toolName as string) ?? null,
toolInput: truncateToolInput(
  (body.tool_input as Record<string, unknown>)
  ?? parseCopilotToolArgs(body.toolArgs)
  ?? null
),
```

### Known payload structures (verified against Copilot CLI v1.0.12)

Verified by running Copilot CLI with hooks enabled and capturing actual stdin payloads.

**Critical finding:** All payloads include a `sessionId` field (UUID) — **not documented in GitHub docs** but present in practice. This enables direct session-ID capture from hook events (see Phase 2C).

```typescript
// sessionStart — verified
{ sessionId: string, timestamp: number, cwd: string, source: 'new' | 'resume' | 'startup', initialPrompt?: string }
// Example: {"sessionId":"880a1c36-b2ed-4ef3-a957-200078d19d12","timestamp":1774790225890,"cwd":"/private/tmp","source":"new","initialPrompt":"list files in current directory"}

// sessionEnd — verified
{ sessionId: string, timestamp: number, cwd: string, reason: string }

// userPromptSubmitted — from docs (not triggered in headless --prompt mode)
{ sessionId: string, timestamp: number, cwd: string, prompt: string }

// preToolUse — verified (toolArgs is JSON STRING)
{ sessionId: string, timestamp: number, cwd: string, toolName: string, toolArgs: string /* JSON string */ }

// postToolUse — verified (toolArgs is OBJECT, not string — inconsistent with preToolUse!)
{ sessionId: string, timestamp: number, cwd: string, toolName: string, toolArgs: object, toolResult: { resultType: string, textResultForLlm: string } }

// errorOccurred — from docs
{ sessionId: string, timestamp: number, cwd: string, error: { message: string, name: string, stack?: string } }
```

**`toolArgs` format inconsistency:** In `preToolUse`, `toolArgs` is a JSON string (`"{\"command\": ...}"`). In `postToolUse`, it's a parsed object (`{"command": "..."}`). The `parseCopilotToolArgs` helper must handle both:

```typescript
function parseCopilotToolArgs(toolArgs: unknown): Record<string, unknown> | null {
  if (!toolArgs) return null;
  if (typeof toolArgs === 'object') return toolArgs as Record<string, unknown>;
  if (typeof toolArgs === 'string') {
    try { return JSON.parse(toolArgs); } catch { return null; }
  }
  return null;
}
```

### Startup registration

**File: `src/main/index.ts`** — add Copilot block to `initializeHookSystem()`:

```typescript
// Copilot hook bridge: write bridge script + reconcile ~/.copilot/hooks/hooks.json
try {
  writeCopilotBridgeScript();
  reconcileCopilotHooks();
  sessionManager.hookBridgeReady['copilot'] = true;
  logger.info('app', 'Copilot hook bridge configured');
} catch (err) {
  logger.warn('app', 'Copilot hook bridge setup failed — Copilot sessions will use fallback mode', {
    error: err instanceof Error ? err.message : String(err),
  });
}
```

Add `cleanupCopilotHooks()` to the quit handler alongside existing Codex/Gemini cleanup.

### Runtime adapter hook awareness

**File: `src/main/session/agent-runtimes/copilot-runtime.ts`**

Update `buildCopilotCreatePlan` to check hook readiness and pass `MCODE_HOOK_PORT`:

```typescript
export function buildCopilotCreatePlan(ctx: AgentCreateContext): PreparedCreate {
  const { input, hookRuntime } = ctx;
  const bridgeReady = ctx.agentHookBridgeReady && isCopilotCommand(ctx.command);
  const hookMode = bridgeReady && hookRuntime.state === 'ready' ? 'live' : 'fallback';

  const args: string[] = [];
  const model = input.model?.trim() || null;
  if (model) args.push('--model', model);
  if (input.initialPrompt) args.push('-i', input.initialPrompt);

  return {
    hookMode,
    args,
    env: bridgeReady && hookRuntime.port
      ? { MCODE_HOOK_PORT: String(hookRuntime.port) }
      : {},
    dbFields: { model },
  };
}
```

**Note:** Unlike Codex (which requires `--enable codex_hooks` CLI flag), Copilot automatically fires hooks if `~/.copilot/hooks/hooks.json` exists. No additional CLI arg needed — only `MCODE_HOOK_PORT` env var for the bridge script.

### Verification

- Start dev instance, verify `~/.copilot/hooks/hooks.json` is written on startup
- Create Copilot session, verify `hookMode` is `'live'`
- Verify hook events appear in `hook_list_recent` MCP tool output
- Verify session transitions from `starting` → `active` → `idle` via hooks (not just polling)
- Quit mcode, verify hooks are removed from `~/.copilot/hooks/hooks.json`
- Verify user's own hooks in the file are preserved through startup/quit cycle

---

## Phase 2B: Resume

**Goal:** Users can resume ended Copilot sessions via `copilot --resume <UUID>`.

### `prepareResume` implementation

**File: `src/main/session/agent-runtimes/copilot-runtime.ts`**

Add `prepareResume` method to the adapter and `buildCopilotResumePlan` function:

```typescript
export function buildCopilotResumePlan(ctx: AgentPrepareResumeContext): PreparedResume {
  if (!ctx.row.copilotSessionId) throw new Error('Cannot resume: no Copilot session ID recorded');

  const command = ctx.row.command || 'copilot';
  const bridgeReady = ctx.agentHookBridgeReady && ctx.hookRuntime.state === 'ready';
  const hookMode = bridgeReady ? 'live' : 'fallback';

  return {
    command,
    cwd: ctx.row.cwd,
    args: ['--resume', ctx.row.copilotSessionId],
    env: bridgeReady && ctx.hookRuntime.port
      ? { MCODE_HOOK_PORT: String(ctx.hookRuntime.port) }
      : {},
    hookMode,
    logLabel: 'Copilot',
    logContext: {
      copilotSessionId: ctx.row.copilotSessionId,
      cwd: ctx.row.cwd,
      hookMode,
    },
  };
}
```

**Key differences from Codex/Gemini resume:**
- Copilot uses `--resume <UUID>` (not `--resume <index>` like Gemini or `resume <threadId>` like Codex)
- No need to list sessions or resolve an index — the UUID is passed directly
- No validation against session list needed — if the UUID is gone, Copilot CLI itself will error

Update the adapter factory to include `prepareResume`:

```typescript
export function createCopilotRuntimeAdapter(deps: {
  scheduleSessionCapture(input: ScheduleCopilotSessionCaptureInput): void;
}): AgentRuntimeAdapter {
  return {
    sessionType: 'copilot',
    prepareCreate(ctx: AgentCreateContext): PreparedCreate {
      return buildCopilotCreatePlan(ctx);
    },
    afterCreate(ctx: AgentPostCreateContext): void {
      deps.scheduleSessionCapture({ ... });
    },
    prepareResume(ctx: AgentPrepareResumeContext): PreparedResume {
      return buildCopilotResumePlan(ctx);
    },
    pollState: copilotPollState,
  };
}
```

### Resume UX

The renderer already handles resume correctly — Phase 1 added `case 'copilotSessionId'` to both `getResumeIdentity()` and `getResumeUnavailableMessage()` in `session-resume.ts`. Once `copilotSessionId` is captured (Phase 1's `afterCreate` polling), the resume button appears automatically. With Phase 2B, clicking it actually works instead of showing an error.

### Verification

- Create Copilot session, wait for session-ID capture
- Kill session → verify "Resume" button appears
- Click Resume → verify session restarts with `--resume <UUID>`
- Verify resumed session retains conversation context
- Verify resume with invalid UUID shows error gracefully (Copilot CLI error, caught by try/catch)

---

## Phase 2C: Hook-Based Session-ID Capture Upgrade

**Goal:** When hooks are live, capture the Copilot session UUID from the `sessionStart` hook event instead of filesystem polling.

### Current state (Phase 1)

Phase 1's `afterCreate` uses `scheduleCopilotSessionCapture` which polls `~/.copilot/session-state/` for 15s, looking for a new UUID directory matching the session's cwd and timing. This works but has a race window and can be ambiguous if multiple sessions are created concurrently.

### Upgrade path

**Verified finding:** Despite the GitHub docs not documenting it, all Copilot hook payloads include a `sessionId` field containing the UUID (e.g., `"880a1c36-b2ed-4ef3-a957-200078d19d12"`). This makes hook-based capture straightforward — no filesystem polling needed when hooks are live.

**Strategy:** Extract the `sessionId` directly from the `sessionStart` hook event payload:

1. When a `SessionStart` hook event arrives for a Copilot session that has no `copilot_session_id` yet, read `event.payload.sessionId`
2. Persist the UUID via `setCopilotSessionId()` and cancel any pending filesystem polling timer
3. The filesystem polling from Phase 1 remains as a fallback for `hookMode='fallback'` sessions

**Implementation:** In the `onEvent` callback in `session-manager.ts` (wired to the hook server), add a check for Copilot `SessionStart` events:

```typescript
// In onEvent handler, after standard hook processing:
if (hookEventName === 'SessionStart' && session.sessionType === 'copilot' && !session.copilotSessionId) {
  const copilotSessionId = (body.sessionId as string) ?? null;
  if (copilotSessionId) {
    sessionManager.setCopilotSessionId(session.sessionId, copilotSessionId);
  }
}
```

This is lower priority than 2A and 2B since the Phase 1 polling already works, but with the `sessionId` field available, it's trivial to implement alongside 2A.

### Verification

- Create Copilot session with hooks live
- Verify `copilotSessionId` is captured immediately from `sessionStart` hook (not via 15s polling)
- Verify `copilotSessionId` matches the UUID in `~/.copilot/session-state/`
- Verify concurrent session creation doesn't cause cross-capture

---

## Phase 2E: Tests

### Unit tests

**`tests/unit/main/copilot-hook-config.test.ts`** (new):
- `removeMcodeBridgeHooks` — removes mcode entries, preserves user entries
- `mergeMcodeBridgeHooks` — adds entries for all events, idempotent
- `mergeMcodeBridgeHooks` on config with existing user hooks — merges without overwriting
- Round-trip: merge then remove returns original config

**`tests/unit/main/copilot-runtime.test.ts`** (extend):
- `buildCopilotCreatePlan` with hooks ready — `hookMode: 'live'`, `MCODE_HOOK_PORT` in env
- `buildCopilotCreatePlan` with hooks not ready — `hookMode: 'fallback'`, empty env
- `buildCopilotResumePlan` — produces `--resume <UUID>`, correct hookMode
- `buildCopilotResumePlan` without copilotSessionId — throws

**`tests/unit/main/hook-server.test.ts`** (new — no existing file):
- `normalizeHookEventName` for Copilot events (`sessionStart` → `SessionStart`, etc.)
- `parseCopilotToolArgs` — valid JSON string, invalid JSON, null/undefined

### Integration tests

**`tests/suites/copilot-resume.test.ts`** (new):
- Create Copilot session, set copilotSessionId, kill, resume — verify session restarts
- Resume without copilotSessionId — verify error message
- Resume with hooks live — verify hookMode is 'live' on resumed session

### Verification

- `npm test` — all unit tests pass
- `npm run test:mcp -- tests/suites/copilot-resume.test.ts` — integration tests pass

---

## File Change Summary

| File | Action | WP | Purpose |
|------|--------|-----|---------|
| `src/main/hooks/copilot-hook-config.ts` | **New** | 2A | Hook config management for `~/.copilot/hooks/hooks.json` |
| `src/main/hooks/hook-server.ts` | Modify | 2A | Add `COPILOT_EVENT_MAP`, update `normalizeHookEventName()`, add camelCase field fallbacks + `parseCopilotToolArgs()` |
| `src/main/index.ts` | Modify | 2A | Register Copilot hook bridge in `initializeHookSystem()`, cleanup on quit |
| `src/main/session/agent-runtimes/copilot-runtime.ts` | Modify | 2A, 2B | Hook-aware `prepareCreate`, add `prepareResume` + `buildCopilotResumePlan` |
| `~/.mcode/copilot-hook-bridge.sh` | **New** (managed) | 2A | Shell bridge script written on startup |
| `~/.copilot/hooks/hooks.json` | **New** (managed) | 2A | User-scoped hook registration |
| `tests/unit/main/copilot-hook-config.test.ts` | **New** | 2E | Unit tests for hook config manager |
| `tests/unit/main/copilot-runtime.test.ts` | Modify | 2E | Hook-aware create + resume tests |
| `tests/unit/main/hook-server.test.ts` | **New** | 2E | `normalizeHookEventName` + `parseCopilotToolArgs` tests |
| `tests/suites/copilot-resume.test.ts` | **New** | 2E | Integration tests for resume |

Total: 4 modified files, 3 new source files, 3 new test files.

---

## Open Questions

*All original open questions have been resolved via CLI verification. No remaining blockers.*

### Resolved questions

**Hooks file path** — **Resolved.** `~/.copilot/hooks/hooks.json` is picked up globally by Copilot CLI v1.0.12 regardless of CWD. Verified by creating the file and running `copilot --prompt "say hi"` from `/tmp` — the `sessionStart` hook fired successfully. The CLI's `--config-dir` defaults to `~/.copilot`.

**`"env"` field behavior** — **Resolved.** The `"env"` field is additive (merges on top of process environment). Verified: setting `"env": { "COPILOT_HOOK_EVENT": "sessionStart" }` correctly makes `$COPILOT_HOOK_EVENT` available in the hook script while `$MCODE_HOOK_PORT` (absent in test) remains accessible from the PTY environment.

**Hook payload contents** — **Resolved.** Verified against Copilot CLI v1.0.12 (not just docs). Key findings that differ from GitHub docs:
- **`sessionId` IS present** in all payloads (UUID, e.g., `"880a1c36-b2ed-4ef3-a957-200078d19d12"`) — undocumented but verified. This enables direct session-ID capture from hook events.
- No `hook_event_name` field — confirmed, bridge script must inject it.
- camelCase field names (`toolName`, `toolArgs`, `sessionId`) — confirmed.
- `toolArgs` format is **inconsistent**: JSON string in `preToolUse`, parsed object in `postToolUse`. Handler must accept both.

**`errorOccurred` mapping** — **Resolved.** Confirmed as general errors (network, auth, etc.) per docs: payload contains `{ error: { message, name, stack } }`. Mapped to `Notification` (not `PostToolUseFailure`).

**User hook merge behavior** — **Resolved.** Multiple hooks per event are supported (arrays, execute in order). mcode's ownership marker pattern (checking `bash` field for `copilot-hook-bridge.sh`) handles merge/cleanup correctly. mcode entries should be appended last so user hooks run first.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Payload field name mismatches break hook processing | Low | Medium | `handleHookPost()` updated to check both camelCase and snake_case; `parseCopilotToolArgs()` handles both string and object formats |
| User hooks overwritten by mcode | Low | High | Ownership marker pattern (bridge script path); merge-not-overwrite; one-time backup |
| Resume UUID expired/deleted by Copilot | Low | Low | Copilot CLI shows its own error; caught by SessionEndedPrompt try/catch |
| `preToolUse` hook blocks tool execution | Low | Medium | Bridge returns `{}` (no `permissionDecision` = allow) |

---

## Phase 2 Deliverable

All blockers resolved via CLI verification. Copilot sessions gain real-time state tracking via hooks (`hookMode='live'`), session resume via `copilot --resume <UUID>`, and instant session-ID capture from hook payloads. The hook bridge adapts the proven Codex/Gemini architecture with Copilot-specific payload handling (event name injection, camelCase field normalization, `toolArgs` format normalization).

## Hand-Off To Phase 3

Phase 3 enables task queue support (`supportsTaskQueue: true`) once hook bridge stability is proven, adds commit tracking verification, and production-hardens the integration. No new architectural patterns needed — it's metadata flag changes and test coverage.

---

## Future Enhancements

### Runtime model detection

The model pill currently shows what was requested at creation time (`--model` flag). The documented hook payloads (per GitHub docs) do not contain model information, so runtime model detection via hooks is not feasible with the current Copilot CLI version. If future Copilot versions add model info to hook payloads, detection can follow the same pattern as Claude's `updateModelFromTranscript()` but using hook events instead of transcript parsing.
