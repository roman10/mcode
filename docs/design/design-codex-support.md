# Codex CLI Support — Design Document

## Overview

mcode currently supports two session types: `'claude'` (Claude Code agent) and `'terminal'` (plain shell). This document describes the design for adding OpenAI Codex CLI as a third supported agent, enabling users to manage Codex sessions alongside Claude Code sessions.

## Feasibility Summary

**Overall: Large (L) — estimated 6-10 weeks for full parity across 3 phases.**

The core blocker is the **hook architecture mismatch**: Claude Code sends HTTP webhooks to mcode's hook server; Codex uses shell-exec hooks (runs a command). Additionally, Codex's hook system is still evolving (events added in recent versions), creating stability risk.

### Integration Point Breakdown

| Integration Point | Difficulty | Size | Notes |
|---|---|---|---|
| Session Spawning | Medium | M | Different command (`codex`), different flags, but same PTY infra |
| Hook System | **Very Hard** | XL | Shell-exec vs HTTP mismatch; missing `PermissionRequest` event; bridge needed |
| State Machine | Easy | S | Pure function, fully reusable with event name mapping |
| Terminal Output Parsing | Hard | L | Codex uses full Ink TUI, not simple `❯` prompt — fragile to parse |
| Auto-Labeling | Easy | S | Same OSC title pattern, different spinner normalization |
| Token Usage Tracking | Medium | L | Different JSONL format/location, different pricing |
| Commit Tracking | Easy | S | Just extend co-author detection strings |
| Account Management | Medium | M | API key-based auth instead of OAuth; may not need HOME isolation |
| Task Queue | Hard | L | Tightly coupled to Claude's prompt patterns and plan mode |
| MCP Devtools | Medium | M | Mostly generic wrappers, need Codex-specific create params |

### What's Reusable

- **PTY layer** — broker, xterm.js, ring buffers, resize all work for any CLI tool
- **State machine** — pure function, reusable with event name mapping
- **Layout engine** — React Mosaic, sidebar, kanban are agent-agnostic
- **Database** — SQLite schema works with minor extensions

### Biggest Blockers

1. **Hook architecture mismatch** — Codex runs shell commands for hooks, mcode expects HTTP POSTs. Need a bridge script.
2. **Codex TUI complexity** — Claude has a simple `❯` prompt for idle detection. Codex uses a full Ink-based TUI.
3. **Hook system immaturity** — Codex hooks are still being added (`AfterToolUse` in v0.100.0, `UserPromptSubmit` in v0.114.0).
4. **No session resume** — Codex has no `--resume` equivalent.
5. **Task queue coupling** — Prompt dispatch relies on detecting Claude's idle prompt and plan mode menus.

---

## Phased Roadmap

### Phase 1: MVP (~2 weeks)

Spawn and manage Codex sessions with basic status tracking. No hooks.

### Phase 2: Hook Integration (~4 weeks)

Rich state tracking via bridge-based hook integration, task queue support, MCP devtools updates.

### Phase 3: Full Parity (~2 weeks)

Token tracking, account management, polish.

---

## Phase 1: Detailed Design

Phase 1 is broken into 4 sub-phases, each independently verifiable.

### Phase 1A: Type System + DB Migration

**Goal:** Add `'codex'` to the type system and database. All existing code continues to work unchanged.

#### Changes

**`src/shared/types.ts:71`**
```typescript
// Before:
export type SessionType = 'claude' | 'terminal';
// After:
export type SessionType = 'claude' | 'codex' | 'terminal';
```

**`src/shared/constants.ts`** — Add Codex icon constant:
```typescript
export const CODEX_ICON = '\u2318'; // ⌘ (U+2318 PLACE OF INTEREST SIGN) — strongly associated with "Codex" in earlier OpenAI branding/discussions
```

**`db/migrations/028_codex_session_type.sql`** — No-op migration (SQLite TEXT column already accepts any string, but document the new value):
```sql
-- Codex session type support: session_type column now also accepts 'codex'.
-- No schema change needed — TEXT column already accepts arbitrary values.
-- This migration exists as a documentation marker.
SELECT 1;
```

#### Verification
- `npm test` — all existing tests pass unchanged
- Grep for `SessionType` to confirm TypeScript compiles with the new union member

---

### Phase 1B: Session Spawning

**Goal:** `SessionManager.create()` can spawn a Codex CLI process when `sessionType: 'codex'` is provided.

#### Changes

**`src/main/session-manager.ts`**

1. Add `isCodexCommand()` helper (next to `isClaudeCommand()` at line 68):
```typescript
function isCodexCommand(command: string): boolean {
  const normalized = basename(command).toLowerCase();
  return normalized === 'codex' || normalized === 'codex.exe';
}
```

2. Add `isAgentSession()` helper:
```typescript
function isAgentSession(sessionType: SessionType): boolean {
  return sessionType === 'claude' || sessionType === 'codex';
}
```

3. Modify `create()` method (lines 203-336). Key changes:

   **Command resolution (line 225-227):**
   ```typescript
   // Before:
   const command = isTerminal ? (input.command ?? process.env.SHELL ?? '/bin/zsh') : (input.command ?? 'claude');
   // After:
   const command = isTerminal
     ? (input.command ?? process.env.SHELL ?? '/bin/zsh')
     : (input.command ?? (sessionType === 'codex' ? 'codex' : 'claude'));
   ```

   **Agent detection (line 229):**
   ```typescript
   // Before:
   const isClaude = !isTerminal && isClaudeCommand(command);
   // After:
   const isClaude = !isTerminal && isClaudeCommand(command);
   const isCodex = !isTerminal && isCodexCommand(command);
   const isAgent = isClaude || isCodex;
   ```

   **Hook mode (line 237):** No change needed — Codex naturally falls to `'fallback'`.

   **Hook initialization gate (line 233):** No change needed — only blocks for Claude.

   **Args builder (lines 240-265):** Add Codex branch:
   ```typescript
   const args: string[] = [];
   if (isTerminal) {
     if (input.args) args.push(...input.args);
   } else if (isCodex) {
     // Codex CLI: for MVP, just pass through the initial prompt as positional arg
     if (input.initialPrompt) {
       args.push(input.initialPrompt);
     }
   } else {
     // Claude args (existing code unchanged)
     if (input.worktree !== undefined) { ... }
     if (input.permissionMode) { ... }
     if (input.effort) { ... }
     if (input.enableAutoMode) { ... }
     if (input.initialPrompt) { ... }
   }
   ```

   **Label/icon normalization (line 210):**
   ```typescript
   function prefixSessionLabel(rawLabel: string, sessionType: SessionType): string {
     if (sessionType === 'claude') {
       return /^[\u2800-\u28FF\u2733]\s*/.test(rawLabel)
         ? rawLabel
         : `${CLAUDE_ICON} ${rawLabel}`;
     }
     if (sessionType === 'codex') {
       return rawLabel.startsWith(CODEX_ICON)
         ? rawLabel
         : `${CODEX_ICON} ${rawLabel}`;
     }
     return rawLabel;
   }

   const label = (() => {
     if (userLabel) return prefixSessionLabel(userLabel, sessionType);

     const autoLabel = (input.initialPrompt ? truncatePromptToLabel(input.initialPrompt, 50) : null)
       || this.nextDisambiguatedLabel(cwd);

     return sessionType === 'terminal' ? autoLabel : prefixSessionLabel(autoLabel, sessionType);
   })();
   ```
   This is required so **auto-generated Codex labels** also carry the Codex icon. Prefixing only `userLabel` is insufficient.

   **DB INSERT (line 278-281):** Use `isClaude` instead of `!isTerminal` for permission_mode, effort, enable_auto_mode fields (these are null for both terminal AND codex sessions).

   **onFirstData status (line 308):**
   ```typescript
   // Before:
   this.updateStatus(sessionId, sessionType === 'claude' ? 'idle' : 'active');
   // After:
   this.updateStatus(sessionId, isAgentSession(sessionType) ? 'idle' : 'active');
   ```

   **Safety net timeout (line 326):**
   ```typescript
   // Before:
   const targetStatus = sessionType === 'claude' && !input.initialCommand ? 'idle' : 'active';
   // After:
   const targetStatus = isAgentSession(sessionType) && !input.initialCommand ? 'idle' : 'active';
   ```

#### Verification
- Unit test: create a session with `sessionType: 'codex'` and verify:
  - Command resolved to `'codex'`
  - Hook mode is `'fallback'`
  - Session status transitions through `starting` → `idle`
  - Label has `⌘` prefix for both user-provided and auto-generated labels
- Integration test (with `codex` CLI installed): spawn a Codex session, confirm PTY produces output

---

### Phase 1C: UI — Display Codex Sessions

**Goal:** Codex sessions appear correctly in the sidebar, kanban board, and mosaic tiles with distinct visual identity.

#### Changes

**`src/renderer/utils/label-utils.ts`** — Extend icon detection:
```typescript
import { CLAUDE_ICON, CODEX_ICON } from '../../shared/constants';

export function splitLabelIcon(label: string): [icon: string, text: string] {
  // Claude icon: Braille spinners (U+2800-U+28FF) or canonical ✳ (U+2733)
  const claudeMatch = label.match(/^([\u2800-\u28FF\u2733])\s*/);
  if (claudeMatch) return [CLAUDE_ICON, label.slice(claudeMatch[0].length)];

  // Codex icon: ⌘ (U+2318)
  if (label.startsWith(CODEX_ICON)) {
    const text = label.slice(1).trimStart();
    return [CODEX_ICON, text];
  }

  return ['', label];
}
```

**`src/renderer/components/SessionTile/TerminalInstance.tsx`** — Codex cursor handling:
```typescript
// Before:
const hideCursor = sessionType === 'claude';
// After: Codex also manages its own TUI cursor
const hideCursor = sessionType === 'claude' || sessionType === 'codex';
```

**`src/renderer/components/SessionTile/TerminalInstance.tsx`** — Label normalization:
```typescript
// Generalize normalizeClaudeLabel → normalizeAgentLabel:
function normalizeAgentLabel(title: string, sessionType: SessionType): string {
  if (sessionType === 'claude') {
    return title.replace(/^[\u2800-\u28FF\u2733]\s*/, `${CLAUDE_ICON} `);
  }
  if (sessionType === 'codex') {
    return title.startsWith(CODEX_ICON) ? title : `${CODEX_ICON} ${title}`;
  }
  return title;
}
```

**`src/renderer/components/SessionTile/SessionEndedPrompt.tsx`** — Fix ended-state copy:
```tsx
// Before:
{!canResume && session?.sessionType !== 'terminal' && (
  <div className="text-xs text-text-muted">
    No Claude session ID recorded — cannot resume
  </div>
)}

// After:
{session?.sessionType === 'claude' && !canResume && (
  <div className="text-xs text-text-muted">
    No Claude session ID recorded — cannot resume
  </div>
)}
{session?.sessionType === 'codex' && (
  <div className="text-xs text-text-muted">
    Codex sessions cannot currently be resumed
  </div>
)}
```

**`src/renderer/components/SessionTile/SessionEndedPrompt.tsx`** — Align "Start New Session" behavior with the new-session dialog:
```tsx
// Before:
const newSession = await window.mcode.sessions.create({
  cwd: session.cwd,
  permissionMode: session.permissionMode,
  sessionType: session.sessionType,
  accountId: accountOverride,
});

// After:
const newSession = await window.mcode.sessions.create(
  session.sessionType === 'codex'
    ? {
        cwd: session.cwd,
        sessionType: 'codex',
      }
    : {
        cwd: session.cwd,
        permissionMode: session.permissionMode,
        sessionType: session.sessionType,
        accountId: accountOverride,
      },
);
```

Required UI behavior:
- Keep the account selector visible only for Claude ended sessions with multiple accounts.
- Hide the account selector for Codex ended sessions.
- `Start New Session` for Codex is equivalent to creating a fresh Codex session from the same `cwd`; it must not forward Claude-only fields.

**Already correct (no changes needed):**
- `SessionCard.tsx` — `>_` indicator only for terminal sessions
- `KanbanCard.tsx` — same pattern
- `TileFactory.tsx` — only terminal sessions redirected to bottom panel
- `SessionCard.tsx:85` — resumable check: Codex sessions won't have `claudeSessionId`
- `session-ordering.ts` — filters exclude `'terminal'`, so Codex is included
- `CreateTaskDialog.tsx` — filters for `'claude'` only; Codex task support deferred to Phase 2

#### Verification
- Visual: Create a Codex session, verify it appears in sidebar with `⌘` icon
- Visual: Codex session appears in kanban board in correct column
- Visual: Codex session renders as a mosaic tile (not redirected to bottom panel)
- Visual: Terminal cursor is hidden for Codex sessions
- Visual: Ended Codex session shows "cannot currently be resumed" copy instead of Claude-specific copy
- Visual: Ended Codex session hides the account selector and `Start New Session` recreates Codex with only `cwd` + `sessionType`

---

### Phase 1D: Commit Tracking + Session Create UI

**Goal:** Detect Codex-assisted commits. Add "New Codex Session" option to the UI.

#### Changes

**`src/main/commit-tracker.ts`** — Rename and extend detection:
```typescript
// Before:
export function detectClaudeAssisted(coAuthor: string): boolean {
  if (!coAuthor) return false;
  const lower = coAuthor.toLowerCase();
  return lower.includes('claude') || lower.includes('anthropic');
}
// After:
export function detectAIAssisted(coAuthor: string): boolean {
  if (!coAuthor) return false;
  const lower = coAuthor.toLowerCase();
  return lower.includes('claude') || lower.includes('anthropic')
    || lower.includes('codex') || lower.includes('openai');
}
```
Keep the DB column name `is_claude_assisted` as-is to avoid a migration — it semantically means "AI-assisted".

**`src/renderer/components/Sidebar/NewSessionDialog.tsx`** — Add agent type selector (Option B: single dialog):
```typescript
// New state:
const [sessionType, setSessionType] = useState<'claude' | 'codex'>('claude');

// Agent type selector at top of form
// Conditionally render Claude-specific fields (permission mode, effort, auto mode, worktree, account)
// Pass sessionType in onCreate callback
```

Implementation details required for correctness:

- Add a prop so the dialog can open with a preselected agent:
```typescript
interface NewSessionDialogProps {
  open: boolean;
  initialSessionType?: 'claude' | 'codex';
  onOpenChange(open: boolean): void;
  onCreate(input: SessionCreateInput): void;
}
```
- On dialog open, initialize `sessionType` from `initialSessionType ?? 'claude'`.
- On submit, always include `sessionType`.
- When `sessionType === 'codex'`, **omit** Claude-only fields from `onCreate`:
  - `permissionMode`
  - `effort`
  - `enableAutoMode`
  - `worktree`
  - `accountId`
- Hiding the inputs is not sufficient; stale remembered Claude values must not be sent.

Fields by agent type:
| Field | Claude | Codex |
|-------|--------|-------|
| Agent type selector | shown | shown |
| Working directory | shown | shown |
| Label | shown | shown |
| Initial prompt | shown | shown |
| Permission mode | shown | hidden |
| Effort | shown | hidden |
| Auto mode | shown | hidden |
| Worktree | shown | hidden |
| Account | shown | hidden |

**`src/renderer/command-palette/command-registry.ts`** — Add command:
```typescript
{
  id: 'new-codex-session',
  label: 'New Codex Session',
  category: 'General',
  execute: () => executeAppCommand({ command: 'new-session', sessionType: 'codex' }),
},
```

**`src/shared/types.ts` + `src/renderer/utils/app-commands.ts` + `src/renderer/stores/layout-store.ts`** — Carry dialog preselection state:
```typescript
// AppCommand
| { command: 'new-session'; sessionType?: 'claude' | 'codex' }

// layout-store state
showNewSessionDialog: boolean;
newSessionDialogType: 'claude' | 'codex';

// app-commands
case 'new-session':
  useLayoutStore.getState().setNewSessionDialogType(command.sessionType ?? 'claude');
  useLayoutStore.getState().setShowNewSessionDialog(true);
  break;
```
`SidebarPanel.tsx` must pass `initialSessionType={newSessionDialogType}` into `NewSessionDialog`, and the existing "+" button should explicitly set `'claude'`.

#### Verification
- Create a Codex session via the dialog with the "Codex" agent type selected
- Verify Claude-specific fields are hidden when "Codex" is selected
- Verify Codex creation does not submit hidden Claude-only values
- Make a commit with `Co-authored-by: Codex <noreply@openai.com>` and verify it's detected as AI-assisted
- Command palette shows "New Codex Session" command

---

## Files Modified (Complete List)

| Phase | File | Change |
|-------|------|--------|
| 1A | `src/shared/types.ts` | Add `'codex'` to `SessionType` union |
| 1A | `src/shared/constants.ts` | Add `CODEX_ICON` constant (`⌘`) |
| 1A | `db/migrations/028_codex_session_type.sql` | Documentation marker migration |
| 1B | `src/main/session-manager.ts` | `isCodexCommand()`, `isAgentSession()`, Codex arg builder, label prefix helper, status transitions |
| 1C | `src/renderer/utils/label-utils.ts` | Extend `splitLabelIcon()` for Codex icon |
| 1C | `src/renderer/components/SessionTile/TerminalInstance.tsx` | Hide cursor for Codex, add `normalizeAgentLabel()` |
| 1C | `src/renderer/components/SessionTile/SessionEndedPrompt.tsx` | Codex-specific non-resumable copy; Codex-safe "Start New Session" behavior |
| 1D | `src/main/commit-tracker.ts` | Rename `detectClaudeAssisted` → `detectAIAssisted`, add Codex patterns |
| 1D | `src/renderer/components/Sidebar/NewSessionDialog.tsx` | Agent type selector, conditional Claude-specific fields |
| 1D | `src/renderer/components/Sidebar/SidebarPanel.tsx` | Pass dialog preselection state; optional Codex session button |
| 1D | `src/renderer/command-palette/command-registry.ts` | "New Codex Session" command |
| 1D | `src/renderer/utils/app-commands.ts` | Open dialog with preselected agent type |
| 1D | `src/renderer/stores/layout-store.ts` | Store dialog agent preselection |

## Testing Strategy

Each sub-phase has its own verification criteria. Additionally:

- **Unit tests:** Extend `tests/unit/test-factories.ts` to support creating Codex session fixtures
- **Unit tests:** Extend `tests/unit/renderer/utils/label-utils.test.ts` for Codex icon splitting/normalization
- **Unit tests:** Add `session-manager` coverage for auto-generated Codex labels and null Claude-only DB fields
- **Integration test:** Use MCP devtools to create a Codex session (`session_create` with `sessionType: 'codex'`), verify it appears in session list
- **Manual test:** Install Codex CLI locally, create a session, interact with it, verify tiling and sidebar work correctly
- **Regression:** Run full `npm test` after each sub-phase to ensure no existing functionality breaks

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Codex hook API changes | High | High | Keep bridge thin; always have PTY fallback |
| Codex TUI output changes | High | Medium | Rely on hooks when available; make patterns configurable |
| Codex CLI not installed | Medium | Low | Detect at startup, same as Claude CLI check |
| Maintenance burden of two agents | Medium | Medium | AgentProvider abstraction in Phase 2 |

## Future Architecture (Phase 2+)

Once real Codex integration is tested and differences are fully understood, extract an `AgentProvider` interface:

```typescript
interface AgentProvider {
  type: SessionType;
  icon: string;
  buildSpawnArgs(input: SessionCreateInput): { command: string; args: string[]; env: Record<string, string> };
  configureHooks?(port: number): void;
  isIdlePrompt?(buffer: string): boolean;
  mapHookEvent?(event: string): HookEventName | null;
  normalizeLabel?(title: string): string;
  detectCoAuthor?(trailer: string): boolean;
}
```

This makes adding a third agent (e.g., Cursor Agent) straightforward without accumulating more if/else branches.
