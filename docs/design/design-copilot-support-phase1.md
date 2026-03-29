# Copilot CLI Support — Phase 1 Design

## Overview

Phase 1 delivers the MVP: spawn, display, interact with, and kill Copilot CLI sessions inside mcode. Status tracking uses fallback PTY polling. No hooks, no resume, no task queue.

The scope mirrors Gemini Phase 1 and Codex Phase 1: prove that the agent runtime adapter pattern accommodates a 4th agent cleanly, persist resume identity early, and expose enough surface for automated testing.

Prerequisite reading: [design-copilot-support.md](./design-copilot-support.md) (overview, verified CLI constraints, feasibility summary).

## Work Packages

Phase 1 is split into 5 sub-phases (1A–1E), each independently verifiable.

| WP | Description | Dependencies |
|----|-------------|-------------|
| 1A | Pre-implementation refactoring (R1, R2, R3) | None |
| 1B | Type system + DB migration | None |
| 1C | Agent metadata + runtime adapter | 1A (R3), 1B |
| 1D | UI integration | 1B, 1C |
| 1E | MCP devtools + test fixture + tests | 1B, 1C, 1D |

---

## Phase 1A: Pre-Implementation Refactoring

Three small, independently verifiable refactors that reduce per-agent branching before adding the 4th agent. Each is a separate commit.

### R1: Generalize commit co-author detection

**File:** `src/main/trackers/commit-tracker.ts` (lines 77–82)

**Current:**
```typescript
export function detectAIAssisted(coAuthor: string): boolean {
  if (!coAuthor) return false;
  const lower = coAuthor.toLowerCase();
  return lower.includes('claude') || lower.includes('anthropic')
    || lower.includes('codex') || lower.includes('openai');
}
```

**After:**
```typescript
const AI_COAUTHOR_PATTERNS = ['claude', 'anthropic', 'codex', 'openai', 'copilot'];

export function detectAIAssisted(coAuthor: string): boolean {
  if (!coAuthor) return false;
  const lower = coAuthor.toLowerCase();
  return AI_COAUTHOR_PATTERNS.some(p => lower.includes(p));
}
```

Note: `'github'` is intentionally excluded — it would false-positive on Dependabot, GitHub Actions bots, and other GitHub-authored commit trailers. `'copilot'` alone is sufficient to match `Co-Authored-By: GitHub Copilot`.

**Verification:** Existing `detectAIAssisted` unit tests pass unchanged. Add test case: `detectAIAssisted('GitHub Copilot <noreply@github.com>')` returns `true`.

### R2: Fix model field visibility in NewSessionDialog

**File:** `src/renderer/components/Sidebar/NewSessionDialog.tsx` (lines 35–37)

**Current:**
```typescript
const agentDefinition = getAgentDefinition(sessionType);
const isClaude = agentDefinition?.dialogMode === 'full';
const isGemini = sessionType === 'gemini';
```

Model field at line 201 is gated by `isGemini`:
```tsx
{isGemini && (
  <div>
    <label ...>Model (optional)</label>
    <input ... />
  </div>
)}
```

**After:**
```typescript
const agentDefinition = getAgentDefinition(sessionType);
const isClaude = agentDefinition?.dialogMode === 'full';
const showModelField = agentDefinition?.supportsModelDisplay ?? false;
```

Model field gate changes to `showModelField`:
```tsx
{showModelField && (
  <div>
    <label ...>Model (optional)</label>
    <input ... />
  </div>
)}
```

The `isGemini` variable is removed. Two additional changes are required:

1. **`handleSubmit` model gating** (line 103): `model: isGemini ? (model.trim() || undefined) : undefined` must change to `model: showModelField ? (model.trim() || undefined) : undefined`. Without this, the model field is visible but the value is never sent for non-Gemini agents.

2. **Model placeholder text**: The hardcoded `"gemini-3-flash-preview"` placeholder should be made generic or agent-aware, e.g., `"e.g. claude-sonnet-4.5"`.

Note: Claude has `supportsModelDisplay: true`, so the model field will appear for Claude in the `isClaude` section as well. This is correct — Claude Code supports `--model`. The `isClaude` section's own fields (permission mode, effort, etc.) are additive, and the model field appears in the shared section above them.

**Verification:** Open New Session Dialog, select Gemini — model field visible. Select Claude — model field visible (correct, Claude supports model selection). Select Codex — model field hidden (`supportsModelDisplay: false`). Submit with model set — verify model value is included in the `onCreate` payload for both Claude and Gemini.

### R3: Generalize `getAgentRuntimeAdapter` lookup

**File:** `src/main/session/agent-runtime.ts` (lines 104–112)

**Current:**
```typescript
export function getAgentRuntimeAdapter(
  sessionType: string | undefined,
  adapters: AgentRuntimeAdapterMap,
): AgentRuntimeAdapter | null {
  if (sessionType === 'claude' || sessionType === 'codex' || sessionType === 'gemini') {
    return adapters[sessionType];
  }
  return null;
}
```

**After:**
```typescript
import { isAgentSessionType } from '../../shared/session-agents';

export function getAgentRuntimeAdapter(
  sessionType: string | undefined,
  adapters: AgentRuntimeAdapterMap,
): AgentRuntimeAdapter | null {
  return isAgentSessionType(sessionType) ? adapters[sessionType] : null;
}
```

This means adding `'copilot'` to `AgentSessionType` in Phase 1B automatically makes the adapter lookup work — no further changes needed in `agent-runtime.ts`.

**Verification:** `npm test` passes — existing adapter lookup behavior is identical.

---

## Phase 1B: Type System + DB Migration

**Goal:** Add `'copilot'` to the type system and database. All existing code continues to work unchanged.

### Type changes

**`src/shared/types.ts`**

1. `SessionType` union (line 71):
```typescript
// Before:
export type SessionType = 'claude' | 'codex' | 'gemini' | 'terminal';
// After:
export type SessionType = 'claude' | 'codex' | 'gemini' | 'copilot' | 'terminal';
```

2. `SessionInfo` interface — add `copilotSessionId` field (after line 90):
```typescript
claudeSessionId: string | null;
codexThreadId: string | null;
geminiSessionId: string | null;
copilotSessionId: string | null;   // NEW
```

3. `AppCommand` type (line 151) — derive `sessionType` from `AgentSessionType` instead of hardcoding:
```typescript
// Before:
| { command: 'new-session'; sessionType?: 'claude' | 'codex' | 'gemini' }
// After:
| { command: 'new-session'; sessionType?: AgentSessionType }
```

This requires importing `AgentSessionType` from `session-agents.ts`. The import is acceptable because `types.ts` already depends on shared types; `session-agents.ts` has no dependency on `types.ts` (it only imports constants), so no circular dependency is introduced.

**`src/shared/constants.ts`**

Add Copilot icon constant:
```typescript
// Copilot icon — ★ (U+2605), used as session label prefix for Copilot CLI sessions
export const COPILOT_ICON = '\u2605';
```

Icon choice: GitHub Copilot branding uses a star/sparkle motif. U+2605 (★) is visually distinct from Claude's ✳ (U+2733), Codex's ❂ (U+2742), and Gemini's ✦ (U+2726).

**`src/shared/session-agents.ts`**

1. `AgentSessionType` (line 4):
```typescript
// Before:
export type AgentSessionType = 'claude' | 'codex' | 'gemini';
// After:
export type AgentSessionType = 'claude' | 'codex' | 'gemini' | 'copilot';
```

2. `AgentResumeIdentityKind` (line 6):
```typescript
// Before:
export type AgentResumeIdentityKind = 'claudeSessionId' | 'codexThreadId' | 'geminiSessionId' | null;
// After:
export type AgentResumeIdentityKind = 'claudeSessionId' | 'codexThreadId' | 'geminiSessionId' | 'copilotSessionId' | null;
```

3. Add Copilot entry to `AGENT_DEFINITIONS` (after `gemini` at line 63):
```typescript
copilot: {
  sessionType: 'copilot',
  displayName: 'Copilot CLI',
  icon: COPILOT_ICON,
  defaultCommand: 'copilot',
  supportsTaskQueue: false,        // Phase 2 — enable after hook bridge
  supportsPlanMode: false,         // Copilot has /plan but not Claude-style plan mode
  hidesTerminalCursor: true,       // TBD — verify; conservative default
  dialogMode: 'minimal',          // No permission mode, effort, worktree, account
  supportsAccountProfiles: false,
  supportsModelDisplay: true,      // Copilot supports --model
  installHelpUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/using-copilot-cli',
  resumeIdentityKind: 'copilotSessionId',
},
```

### DB migration

**`db/migrations/033_copilot_support.sql`** (new file):
```sql
ALTER TABLE sessions ADD COLUMN copilot_session_id TEXT;
CREATE UNIQUE INDEX idx_sessions_copilot_session_id
  ON sessions (copilot_session_id) WHERE copilot_session_id IS NOT NULL;
```

Follows the pattern from `031_gemini_resume.sql` exactly.

### `AgentResumeRow` in `agent-runtime.ts`

Add `copilotSessionId` to the interface (after `geminiSessionId` at line 22):
```typescript
export interface AgentResumeRow {
  command: string | null;
  cwd: string;
  codexThreadId: string | null;
  geminiSessionId: string | null;
  claudeSessionId: string | null;
  copilotSessionId: string | null;   // NEW
  permissionMode: string | null;
  effort: string | null;
  enableAutoMode: boolean;
  allowBypassPermissions: boolean;
  worktree: string | null;
}
```

### `SessionRecord` and `toSessionInfo` in `session-manager.ts`

The internal `SessionRecord` interface (line 63) and `toSessionInfo()` mapper (line 91) must include the new column, otherwise the DB column exists but is never read into `SessionInfo`.

**`SessionRecord`** — add after `gemini_session_id` (line 74):
```typescript
copilot_session_id: string | null;
```

**`toSessionInfo()`** — add after `geminiSessionId` mapping (line 106):
```typescript
copilotSessionId: row.copilot_session_id,
```

### Resume row construction in `session-manager.ts`

The `resume()` method builds an `AgentResumeRow` at lines 378–389. Add `copilotSessionId` so Phase 2's `prepareResume` receives the stored ID:

```typescript
row: {
  command: row.command,
  cwd: row.cwd,
  codexThreadId: row.codex_thread_id,
  geminiSessionId: row.gemini_session_id,
  claudeSessionId: row.claude_session_id,
  copilotSessionId: row.copilot_session_id,   // NEW
  permissionMode: row.permission_mode,
  effort: row.effort,
  enableAutoMode: row.enable_auto_mode === 1,
  allowBypassPermissions: row.allow_bypass_permissions === 1,
  worktree: row.worktree,
},
```

### Verification

- `npm test` passes — no runtime behavior changes
- TypeScript compiles with the new union members
- DB migration runs without error (test by starting a dev instance)

---

## Phase 1C: Agent Metadata + Runtime Adapter

**Goal:** Copilot sessions can be spawned, have their session ID captured in the background, and use fallback quiescence polling.

### Runtime adapter

**New file: `src/main/session/agent-runtimes/copilot-runtime.ts`**

The adapter follows the same structure as `codex-runtime.ts` and `gemini-runtime.ts`.

#### `isCopilotCommand()`

```typescript
import { basename } from 'node:path';

export function isCopilotCommand(command: string): boolean {
  const normalized = basename(command).toLowerCase();
  return normalized === 'copilot' || normalized === 'copilot.exe';
}
```

#### `buildCopilotCreatePlan()`

Builds the CLI args for `copilot` session creation.

```typescript
export function buildCopilotCreatePlan(ctx: AgentCreateContext): PreparedCreate {
  const args: string[] = [];
  if (ctx.input.model) args.push('--model', ctx.input.model);
  if (ctx.input.initialPrompt) args.push('-i', ctx.input.initialPrompt);

  return {
    hookMode: 'fallback',   // Phase 1: no hooks
    args,
    env: {},
    dbFields: {
      model: ctx.input.model?.trim() || null,
    },
  };
}
```

Key decisions:
- **`-i`/`--interactive` flag** for initial prompt. Verified against Copilot CLI v1.0.12: `-p`/`--prompt` is **headless** (non-interactive, exits after completion). `-i`/`--interactive` starts the interactive PTY session and auto-submits the prompt as the first message. Bare `copilot` starts interactive with no initial prompt.
- **`hookMode: 'fallback'`** always — no hook bridge in Phase 1.
- **`--model`** passed through when set — same pattern as Gemini.
- **No `env`** in Phase 1 — `MCODE_HOOK_PORT` is not needed until Phase 2.

#### `scheduleCopilotSessionCapture()`

Polls `~/.copilot/session-state/` to find the newly created session's UUID and persists it as `copilot_session_id`. This runs asynchronously after session creation.

```typescript
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface ScheduleCopilotSessionCaptureInput {
  sessionId: string;
  cwd: string;
  startedAt: string;
}

export function scheduleCopilotSessionCapture(
  input: ScheduleCopilotSessionCaptureInput,
  deps: { broadcastSessionUpdate(sessionId: string): void },
): void {
  const startedAtMs = Date.parse(input.startedAt);
  if (!Number.isFinite(startedAtMs)) return;

  const deadline = Date.now() + 15_000;

  const poll = async (): Promise<void> => {
    const db = getDb();
    const row = db.prepare(
      'SELECT session_type, copilot_session_id FROM sessions WHERE session_id = ?',
    ).get(input.sessionId) as { session_type: string; copilot_session_id: string | null } | undefined;
    if (!row || row.session_type !== 'copilot' || row.copilot_session_id) return;

    const claimedSessionIds = new Set(
      (
        db.prepare(
          'SELECT copilot_session_id FROM sessions WHERE copilot_session_id IS NOT NULL AND session_id != ?',
        ).all(input.sessionId) as { copilot_session_id: string }[]
      ).map((entry) => entry.copilot_session_id),
    );

    const match = findCopilotSessionId({
      cwd: input.cwd,
      startedAtMs,
      nowMs: Date.now(),
      claimedSessionIds,
    });

    if (match) {
      const result = db.prepare(
        'UPDATE sessions SET copilot_session_id = ? WHERE session_id = ? AND copilot_session_id IS NULL',
      ).run(match, input.sessionId);
      if (result.changes > 0) {
        logger.info('session', 'Captured Copilot session ID', {
          sessionId: input.sessionId,
          copilotSessionId: match,
        });
        deps.broadcastSessionUpdate(input.sessionId);
      }
      return;
    }

    if (Date.now() >= deadline) {
      logger.warn('session', 'Failed to capture Copilot session ID', {
        sessionId: input.sessionId,
        cwd: input.cwd,
      });
      return;
    }

    setTimeout(() => { poll().catch(() => {}); }, 500);
  };

  poll().catch(() => {});
}
```

This follows the Codex `scheduleCodexThreadCapture` pattern exactly:
- 15s deadline with 500ms polling interval
- Checks that no other mcode session has already claimed the UUID
- Skips if session ID is already set (idempotent)
- Silently gives up on deadline (session works fine without resume identity)

#### `findCopilotSessionId()` — session matching

The matching logic lives in a new session store module (see below). It reads UUID-named directories in `~/.copilot/session-state/`, extracts session metadata, and matches by `cwd` and `created_at` timestamp.

#### `copilotPollState()`

Fallback quiescence detection — identical pattern to Codex and Gemini:

```typescript
export function copilotPollState(ctx: PtyPollContext): StateUpdate | null {
  if (ctx.status === 'active' && ctx.isQuiescent) {
    return {
      status: 'idle',
      attention: { level: 'action', reason: 'Copilot finished — awaiting input' },
    };
  }
  return null;
}
```

#### `createCopilotRuntimeAdapter()`

Factory function returning the adapter:

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
      deps.scheduleSessionCapture({
        sessionId: ctx.sessionId,
        cwd: ctx.cwd,
        startedAt: ctx.startedAt,
      });
    },
    // prepareResume: Phase 2
    pollState: copilotPollState,
  };
}
```

`prepareResume` is intentionally omitted in Phase 1 — the adapter interface makes all methods optional. Resume will be added in Phase 2.

### Session store

**New file: `src/main/session/copilot-session-store.ts`**

Responsible for reading Copilot session state from `~/.copilot/session-state/` and matching sessions.

```typescript
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface CopilotSessionEntry {
  sessionId: string;  // UUID directory name
  cwd: string;
  createdAtMs: number;
}

export interface CopilotSessionMatchInput {
  cwd: string;
  startedAtMs: number;
  nowMs: number;
  claimedSessionIds: Set<string>;
}

/**
 * Resolve the Copilot session-state directory.
 * Respects COPILOT_HOME env override for testing.
 */
export function resolveCopilotStateDir(): string | null {
  const directPath = process.env['MCODE_COPILOT_STATE_DIR'];
  if (directPath) return existsSync(directPath) ? directPath : null;

  const copilotHome = process.env['COPILOT_HOME'] ?? join(homedir(), '.copilot');
  const stateDir = join(copilotHome, 'session-state');
  return existsSync(stateDir) ? stateDir : null;
}

/**
 * Parse the first line of events.jsonl to extract session metadata.
 *
 * Verified against Copilot CLI v1.0.12: the first event is always
 * `session.start` with this structure:
 *   {
 *     "type": "session.start",
 *     "data": {
 *       "sessionId": "<UUID>",
 *       "startTime": "<ISO 8601>",
 *       "context": { "cwd": "/path/..." }
 *     },
 *     "timestamp": "<ISO 8601>"
 *   }
 *
 * Note: fields are nested under `data` (camelCase), NOT at the top level.
 */
export function parseEventsJsonlFirstLine(
  eventsPath: string,
): { sessionId: string; cwd: string; startTime: string } | null {
  try {
    const content = readFileSync(eventsPath, 'utf8');
    const firstLine = content.split('\n')[0]?.trim();
    if (!firstLine) return null;

    const event = JSON.parse(firstLine);
    if (event.type !== 'session.start') return null;

    const data = event.data;
    if (!data) return null;

    const sessionId = data.sessionId;
    const cwd = data.context?.cwd;
    const startTime = data.startTime ?? event.timestamp;

    if (!sessionId || !cwd || !startTime) return null;
    return { sessionId, cwd, startTime };
  } catch {
    return null;
  }
}

/**
 * Parse workspace.yaml to extract session metadata.
 *
 * Fallback for sessions that don't have events.jsonl (observed: most
 * short-lived or empty sessions only have workspace.yaml).
 *
 * workspace.yaml uses snake_case:
 *   id: <UUID>
 *   cwd: /path/...
 *   created_at: <ISO 8601>
 *
 * Uses simple line-based parsing to avoid a YAML parser dependency.
 */
export function parseWorkspaceYaml(
  yamlPath: string,
): { sessionId: string; cwd: string; startTime: string } | null {
  try {
    const content = readFileSync(yamlPath, 'utf8');
    const fields: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) fields[match[1]] = match[2].trim();
    }

    const sessionId = fields['id'];
    const cwd = fields['cwd'];
    const startTime = fields['created_at'];

    if (!sessionId || !cwd || !startTime) return null;
    return { sessionId, cwd, startTime };
  } catch {
    return null;
  }
}

/**
 * List all Copilot sessions from the state directory.
 *
 * Tries events.jsonl first (richer data), falls back to workspace.yaml.
 * Verified: most short-lived sessions only have workspace.yaml; only
 * actively-used sessions have events.jsonl.
 */
export function listCopilotSessions(): CopilotSessionEntry[] {
  const stateDir = resolveCopilotStateDir();
  if (!stateDir) return [];

  const entries: CopilotSessionEntry[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(stateDir);
  } catch {
    return [];
  }

  for (const dirname of dirs) {
    // UUID-format directory names only
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dirname)) continue;

    const eventsPath = join(stateDir, dirname, 'events.jsonl');
    const yamlPath = join(stateDir, dirname, 'workspace.yaml');
    const parsed = parseEventsJsonlFirstLine(eventsPath) ?? parseWorkspaceYaml(yamlPath);
    if (!parsed) continue;

    const createdAtMs = Date.parse(parsed.startTime);
    if (!Number.isFinite(createdAtMs)) continue;

    entries.push({
      sessionId: dirname,
      cwd: parsed.cwd,
      createdAtMs,
    });
  }

  return entries;
}

/**
 * Find the Copilot session UUID that matches a newly spawned session.
 *
 * Matching criteria:
 *   - cwd must match exactly
 *   - created_at must be within [startedAtMs - 5s, nowMs + 1s]
 *   - sessionId must not already be claimed by another mcode session
 *   - If multiple eligible entries, return null (ambiguous)
 */
export function selectCopilotSessionCandidate(
  entries: CopilotSessionEntry[],
  input: CopilotSessionMatchInput,
): string | null {
  const lowerBoundMs = input.startedAtMs - 5_000;
  const upperBoundMs = input.nowMs + 1_000;

  const eligible = entries.filter(entry =>
    entry.cwd === input.cwd
    && !input.claimedSessionIds.has(entry.sessionId)
    && entry.createdAtMs >= lowerBoundMs
    && entry.createdAtMs <= upperBoundMs,
  );

  return eligible.length === 1 ? eligible[0].sessionId : null;
}

/**
 * Combined: list sessions and match.
 * Returns the matched session UUID, or null if no unique match.
 */
export function findCopilotSessionId(input: CopilotSessionMatchInput): string | null {
  const entries = listCopilotSessions();
  return selectCopilotSessionCandidate(entries, input);
}
```

Key design decisions:

1. **`events.jsonl` primary, `workspace.yaml` fallback**: Verified against real Copilot CLI v1.0.12 data: `events.jsonl` has richer data but is only present in actively-used sessions. Most short-lived sessions only have `workspace.yaml`. Both parsers are needed. The `workspace.yaml` parser uses simple line-based parsing (not a YAML library) since the format is flat key-value pairs.

2. **Verified field structure**: `events.jsonl` fields are nested under `data` (camelCase: `data.sessionId`, `data.context.cwd`, `data.startTime`). `workspace.yaml` uses snake_case at the top level (`id`, `cwd`, `created_at`). The `sessionId` in `events.jsonl` always matches the UUID directory name.

3. **`MCODE_COPILOT_STATE_DIR` env override**: For testing. The fixture tests can point this at a temporary directory with fake session state.

4. **Single-match-only policy**: If multiple sessions match, return `null` rather than guessing. Same conservative approach as Codex's `selectCodexThreadCandidate`.

5. **Directory name IS the UUID**: Unlike Gemini (which needs text parsing) or Codex (which reads SQLite), Copilot stores each session as a UUID-named directory. The directory name itself is the resume identity.

### SessionManager registration

**`src/main/session/session-manager.ts`**

Add Copilot adapter to the adapter map (after `gemini` at line 198):

```typescript
this.agentRuntimeAdapters = {
  claude: createClaudeRuntimeAdapter(),
  codex: createCodexRuntimeAdapter({ ... }),
  gemini: createGeminiRuntimeAdapter({ ... }),
  copilot: createCopilotRuntimeAdapter({               // NEW
    scheduleSessionCapture: (input) => scheduleCopilotSessionCapture(input, {
      broadcastSessionUpdate: (sessionId) => this.broadcastSessionUpdate(sessionId),
    }),
  }),
};
```

Add `setCopilotSessionId()` method (after `setGeminiSessionId` at line 1047):

```typescript
setCopilotSessionId(sessionId: string, copilotSessionId: string): void {
  const db = getDb();
  const row = db.prepare('SELECT session_type, copilot_session_id FROM sessions WHERE session_id = ?')
    .get(sessionId) as { session_type: string; copilot_session_id: string | null } | undefined;
  if (!row) throw new Error(`Session not found: ${sessionId}`);
  if (row.session_type !== 'copilot') throw new Error('Only Copilot sessions can store a Copilot session ID');
  if (row.copilot_session_id === copilotSessionId) return;
  db.prepare('UPDATE sessions SET copilot_session_id = ? WHERE session_id = ?').run(copilotSessionId, sessionId);
  this.broadcastSessionUpdate(sessionId);
}
```

Follows the identical pattern from `setCodexThreadId` (line 1027) and `setGeminiSessionId` (line 1038).

### Verification

- Create a Copilot session via MCP `session_create` with `sessionType: 'copilot'`
- Verify command resolves to `copilot` (from `getDefaultSessionCommand` → agent metadata)
- Verify `hookMode` is `'fallback'`
- Verify `--model` arg is passed when `model` is provided
- Verify `-i` arg is passed when `initialPrompt` is provided
- Verify label has ★ prefix
- Verify session-ID capture fires (using the test fixture with fake session state)

---

## Phase 1D: UI Integration

**Goal:** Copilot sessions appear correctly in all UI surfaces.

Most UI changes are metadata-driven via existing abstractions. The following sections document what needs manual updates vs. what works automatically.

### Already works (no changes needed)

These are driven by agent metadata and shared helpers:

| Surface | Why it works |
|---------|-------------|
| **Sidebar icon** | `splitLabelIcon()` in `label-utils.ts` iterates `AGENT_SESSION_TYPES` with a generic loop — ★ prefix is handled automatically when `'copilot'` is added to the type |
| **Sidebar ordering** | `session-ordering.ts` excludes only `'terminal'` — Copilot sessions are included |
| **Kanban board** | Session type is generic — Copilot sessions appear in the correct column based on status |
| **Tiles** | Copilot PTY renders in the shared terminal component |
| **Cursor hiding** | `shouldHideTerminalCursor()` returns `hidesTerminalCursor` from agent metadata |
| **Menu** | Single generic "New Session" command — no per-agent entries |
| **Label prefix** | `prefixSessionLabel()` in `session-launch.ts` uses generic `getAgentDefinition().icon` path |
| **Ended session "Start New"** | `buildStartNewSessionInput()` in `session-resume.ts` uses `dialogMode: 'minimal'` — only sends `cwd` + `sessionType` |
| **Model pill display** | `canDisplaySessionModel()` checks `supportsModelDisplay` flag — works for Copilot |

### Label utils — no changes needed

`splitLabelIcon()` in `src/renderer/utils/label-utils.ts` already uses a generic agent icon loop (lines 34–40):

```typescript
for (const sessionType of AGENT_SESSION_TYPES) {
  if (sessionType === 'claude') continue;
  const agent = getAgentDefinition(sessionType);
  if (agent && label.startsWith(agent.icon)) {
    return [agent.icon, label.slice(agent.icon.length).trimStart()];
  }
}
```

Adding `'copilot'` to `AGENT_SESSION_TYPES` (via Phase 1B) automatically includes the ★ icon in this loop. No manual changes needed.

### Hardcoded locations requiring update

| Location | What to update | Details |
|----------|---------------|---------|
| `src/renderer/components/Sidebar/NewSessionDialog.tsx:140-148` | Add `<option value="copilot">Copilot CLI</option>` | Hardcoded `<option>` list |
| `src/renderer/utils/session-resume.ts:7-16` | Add `case 'copilotSessionId'` | `getResumeIdentity()` switch — map to `session.copilotSessionId` |
| `src/renderer/utils/session-resume.ts:26-35` | Add `case 'copilotSessionId'` | `getResumeUnavailableMessage()` switch — return `'No Copilot session ID recorded — cannot resume'` |

### NewSessionDialog changes

**`src/renderer/components/Sidebar/NewSessionDialog.tsx`** — Add Copilot option (line ~147):

```tsx
<select ...>
  <option value="claude">Claude Code</option>
  <option value="codex">Codex CLI</option>
  <option value="gemini">Gemini CLI</option>
  <option value="copilot">Copilot CLI</option>    {/* NEW */}
</select>
```

When Copilot is selected:
- `dialogMode: 'minimal'` hides Claude-specific fields (permission mode, effort, auto mode, worktree, account)
- `supportsModelDisplay: true` shows the model field (via R2 refactor)
- The model field placeholder should use `agentDefinition?.displayName` to show a contextual hint, e.g., `{displayName} model name` which renders as "Copilot CLI model name" or "Gemini CLI model name". Simpler than maintaining per-agent model name examples.

### session-resume.ts changes

**`src/renderer/utils/session-resume.ts`** — Two switch statements need the new case:

```typescript
// In getResumeIdentity() (line 7-16):
case 'copilotSessionId':
  return session.copilotSessionId;

// In getResumeUnavailableMessage() (line 26-35):
case 'copilotSessionId':
  return 'No Copilot session ID recorded — cannot resume';
```

**Phase 1 resume UX:** Adding these switch cases means the resume button will appear once a `copilotSessionId` is captured. Since Phase 1 does not implement `prepareResume` on the adapter, clicking the button triggers `SessionManager.resume()` which throws `"Cannot resume: no resume handler for session type 'copilot'"`. This error is caught by `SessionEndedPrompt`'s try/catch (line 50) and displayed as inline red text — no crash or app instability.

This is acceptable for Phase 1 because:
- Session-ID capture can be verified via MCP tools and integration tests
- The error message is clear and actionable ("no resume handler")
- Phase 2 adds `prepareResume` which resolves this automatically
- Same pattern Codex used during its Phase 1

### Verification

- New Session Dialog: Copilot appears in the agent dropdown
- New Session Dialog: Selecting Copilot hides Claude-specific fields, shows model field
- Sidebar: Copilot session appears with ★ icon
- Kanban: Copilot session appears in correct status column
- Tile: Copilot PTY output renders correctly
- Ended session: Shows "No Copilot session ID recorded — cannot resume" when no ID captured

---

## Phase 1E: MCP Devtools + Test Fixture + Tests

**Goal:** Copilot sessions are testable via MCP tools and have automated coverage.

### MCP devtools changes

**`src/devtools/tools/session-tools.ts`**

1. Add `'copilot'` to the `session_create` Zod enum (line 35):
```typescript
// Before:
sessionType: z.enum(['claude', 'codex', 'gemini', 'terminal']).optional()
// After:
sessionType: z.enum(['claude', 'codex', 'gemini', 'copilot', 'terminal']).optional()
  .describe('Session type: "claude" for Claude Code, "codex" for Codex CLI, "gemini" for Gemini CLI, "copilot" for Copilot CLI, "terminal" for plain shell (default: "claude")'),
```

2. Add `session_set_copilot_session_id` MCP tool (after `session_set_gemini_session_id` at line 367):
```typescript
server.registerTool('session_set_copilot_session_id', {
  description: 'Set the Copilot session ID for a session (useful for testing or manual recovery)',
  inputSchema: {
    sessionId: z.string().describe('The session ID'),
    copilotSessionId: z.string().describe('Copilot session ID (UUID)'),
  },
  annotations: { readOnlyHint: false },
}, async ({ sessionId, copilotSessionId }) => {
  try {
    ctx.sessionManager.setCopilotSessionId(sessionId, copilotSessionId);
    const updated = ctx.sessionManager.get(sessionId);
    return {
      content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
      isError: true,
    };
  }
});
```

### Test fixture

**New file: `tests/fixtures/copilot`** (executable shell script):

```sh
#!/bin/sh

printf 'fake copilot ready\n'
if [ "$#" -gt 0 ]; then
  printf 'argv: %s\n' "$*"
fi

trap 'exit 0' TERM INT

while :; do
  sleep 3600
done
```

Same pattern as the existing `tests/fixtures/codex` fixture. Prints `fake copilot ready`, echoes args for verification, and sleeps indefinitely until killed.

### Test helpers

**`tests/helpers.ts`** — Add Copilot test helper:

```typescript
const TEST_COPILOT_PATH = join(process.cwd(), 'tests', 'fixtures', 'copilot');

export async function createCopilotTestSession(
  client: McpTestClient,
  overrides?: Record<string, unknown>,
): Promise<SessionInfo> {
  return client.callToolJson<SessionInfo>('session_create', {
    cwd: process.cwd(),
    command: TEST_COPILOT_PATH,
    label: `copilot-${Date.now()}`,
    sessionType: 'copilot',
    ...overrides,
  });
}
```

### Integration test suite

**New file: `tests/suites/copilot-support.test.ts`**

Coverage targets:

```typescript
describe('copilot support', () => {
  it('creates a Copilot session via MCP');
  // - sessionType is 'copilot'
  // - status starts as 'starting', transitions to 'idle'
  // - label has ★ prefix
  // - hookMode is 'fallback'
  // - permissionMode, enableAutoMode, effort are undefined

  it('omits Claude-only fields for Copilot sessions even if they are provided');
  // - permissionMode, effort, enableAutoMode, allowBypassPermissions, worktree are null/undefined
  // - Same pattern as gemini-support.test.ts:91-111

  it('shows Copilot sessions in the sidebar and kanban as agent sessions');
  // - Session appears in sidebar_get_sessions with correct sessionType
  // - Session appears in kanban_get_columns in correct column

  it('persists an explicit Copilot model and launches with --model');
  // - Create with model: 'gpt-4.1'
  // - session.model is 'gpt-4.1'
  // - fixture echoes '--model gpt-4.1' in argv

  it('passes initial prompt via -i flag');
  // - Create with initialPrompt: 'review the code'
  // - fixture echoes '-i review the code' in argv

  it('sets Copilot session ID via MCP tool');
  // - Create session, set copilotSessionId via session_set_copilot_session_id
  // - Verify session.copilotSessionId is updated
});
```

### Unit tests

**New or extended test files:**

1. **`tests/unit/copilot-session-store.test.ts`** (new):
   - `parseEventsJsonlFirstLine` — valid input with nested `data.sessionId`/`data.context.cwd`/`data.startTime`, missing fields, non-session.start type, malformed JSON
   - `parseWorkspaceYaml` — valid input with `id`/`cwd`/`created_at`, missing fields, empty file
   - `listCopilotSessions` — prefers `events.jsonl`, falls back to `workspace.yaml` when `events.jsonl` absent
   - `selectCopilotSessionCandidate` — single match, multiple matches (returns null), cwd mismatch, timestamp out of range, claimed session excluded
   - `resolveCopilotStateDir` — respects `MCODE_COPILOT_STATE_DIR` env, falls back to `~/.copilot/session-state/`

2. **`tests/unit/copilot-runtime.test.ts`** (new):
   - `buildCopilotCreatePlan` — bare launch, with `--model`, with `-i` initial prompt, with both
   - `isCopilotCommand` — `'copilot'`, `'copilot.exe'`, `'/usr/bin/copilot'`, `'not-copilot'`
   - `copilotPollState` — transitions `active` → `idle` when quiescent, returns null otherwise

3. **`tests/unit/commit-tracker.test.ts`** (extend):
   - `detectAIAssisted('GitHub Copilot <noreply@github.com>')` → `true`
   - `detectAIAssisted('copilot-bot')` → `true`

4. **`tests/unit/renderer/utils/label-utils.test.ts`** (extend):
   - `splitLabelIcon('★ My Session')` → `['★', 'My Session']`

### Verification

- `npm test` — all tests pass, including new Copilot tests
- Integration: `session_create { sessionType: 'copilot' }` works via MCP
- Integration: `session_set_copilot_session_id` works via MCP
- Integration: Copilot session appears in sidebar and kanban

---

## File Change Summary

| File | Action | WP | Purpose |
|------|--------|-----|---------|
| `src/main/trackers/commit-tracker.ts` | Modify | 1A | R1: Extract `AI_COAUTHOR_PATTERNS` array, add `'copilot'` |
| `src/renderer/components/Sidebar/NewSessionDialog.tsx` | Modify | 1A, 1D | R2: `showModelField` capability query; add Copilot `<option>` |
| `src/main/session/agent-runtime.ts` | Modify | 1A, 1B | R3: Use `isAgentSessionType()`; add `copilotSessionId` to `AgentResumeRow` |
| `src/shared/types.ts` | Modify | 1B | Add `'copilot'` to `SessionType`, `copilotSessionId` to `SessionInfo`, derive `AppCommand` sessionType |
| `src/shared/constants.ts` | Modify | 1B | Add `COPILOT_ICON` |
| `src/shared/session-agents.ts` | Modify | 1B | Add `'copilot'` to `AgentSessionType`, `AgentResumeIdentityKind`, `AGENT_DEFINITIONS` |
| `db/migrations/033_copilot_support.sql` | **New** | 1B | Add `copilot_session_id` column + unique index |
| `src/main/session/agent-runtimes/copilot-runtime.ts` | **New** | 1C | Copilot runtime adapter (create, afterCreate, pollState) |
| `src/main/session/copilot-session-store.ts` | **New** | 1C | Session state reader + matcher for `~/.copilot/session-state/` |
| `src/main/session/session-manager.ts` | Modify | 1B, 1C | Add `copilot_session_id` to `SessionRecord` + `toSessionInfo()` + resume row; register Copilot adapter; add `setCopilotSessionId()` |
| `src/renderer/utils/session-resume.ts` | Modify | 1D | Add `case 'copilotSessionId'` to both switches |
| `src/devtools/tools/session-tools.ts` | Modify | 1E | Add `'copilot'` to Zod enum, add `session_set_copilot_session_id` tool |
| `tests/fixtures/copilot` | **New** | 1E | Fake Copilot CLI for tests |
| `tests/helpers.ts` | Modify | 1E | Add `createCopilotTestSession()` helper |
| `tests/suites/copilot-support.test.ts` | **New** | 1E | Integration test suite |
| `tests/unit/copilot-session-store.test.ts` | **New** | 1E | Unit tests for session store |
| `tests/unit/copilot-runtime.test.ts` | **New** | 1E | Unit tests for runtime adapter |

Total: 10 modified files, 7 new files.

---

## Resolved Questions (verified against Copilot CLI v1.0.12)

### 1. ~~`--prompt` flag: interactive or headless?~~ RESOLVED

**Answer:** `-p`/`--prompt` is **headless** — it processes the prompt and exits. The correct flag for interactive + initial prompt is **`-i`/`--interactive`**, which starts the full PTY session and auto-submits the prompt as the first message. Verified via `copilot --help` and official docs.

The adapter uses `-i` (not `--prompt`) for `initialPrompt`. Updated in `buildCopilotCreatePlan` above.

### 2. ~~`events.jsonl` first-line format~~ RESOLVED

**Answer:** Verified from actual on-disk data at `~/.copilot/session-state/`. The first event is always `session.start` with fields nested under `data`:
```json
{
  "type": "session.start",
  "data": {
    "sessionId": "<UUID>",
    "startTime": "<ISO 8601>",
    "context": { "cwd": "/path/..." }
  },
  "timestamp": "<ISO 8601>"
}
```

Additionally, **most sessions don't have `events.jsonl`** — only actively-used sessions do. Short-lived or empty sessions only have `workspace.yaml`. The session store now uses `events.jsonl` as primary and `workspace.yaml` as fallback. Updated in the code above.

### 3. Cursor behavior

`hidesTerminalCursor: true` is set as a conservative default. If Copilot does NOT hide the cursor, the setting causes mcode to add unnecessary cursor hiding, which is harmless but slightly incorrect. Can be verified post-implementation by observing PTY escape sequences.

### 4. ~~`splitLabelIcon` vs. generic agent loop~~ RESOLVED

`splitLabelIcon()` already uses a generic `AGENT_SESSION_TYPES` loop — no per-agent branching needed. Adding `'copilot'` to `AgentSessionType` handles it automatically.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| ~~`--prompt` triggers headless mode~~ | ~~RESOLVED~~ | — | Use `-i`/`--interactive` instead |
| ~~`events.jsonl` format differs from assumption~~ | ~~RESOLVED~~ | — | Verified; `workspace.yaml` fallback added for sessions without `events.jsonl` |
| Copilot CLI not installed on user machine | Expected | Low | Same pattern as other agents — session fails at spawn, no crash |
| Session-ID capture fails (concurrent sessions, rapid create/kill) | Low | Low | Session is non-resumable but otherwise functional |
| `~/.copilot/session-state/` has many entries (slow scan) | Low | Low | 15s deadline with 500ms polling; only scans UUID dirs |

---

## Phase 1 Deliverable

Users can create, view, interact with, and kill Copilot CLI sessions inside mcode. The session's Copilot UUID is captured in the background for later resume (Phase 2). Status tracking uses fallback PTY polling. The model field is shown in the New Session Dialog. All surfaces (sidebar, kanban, tiles, ended-session prompt) handle Copilot sessions correctly via shared agent metadata.

## Hand-Off To Phase 2

Phase 2 adds three capabilities on top of the Phase 1 foundation:

1. **Hook bridge** — `~/.copilot/hooks/hooks.json` registration + bridge script + event mapping → `hookMode='live'`
2. **Resume** — `copilot --resume=<UUID>` via `prepareResume` in the adapter
3. **Runtime model detection** — model changes detected via hook events

The Phase 1 adapter is designed to accept these additions without structural changes — `prepareResume` is simply added as a new method, and `prepareCreate` gains hook awareness.
