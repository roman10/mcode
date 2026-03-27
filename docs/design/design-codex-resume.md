# Codex Resume - Design Document

## Overview

mcode already supports two different "come back to this session" behaviors for agents:

1. **Reconnect a still-running PTY after app restart** via the PTY broker.
2. **Resume an ended conversation in place** by reusing the same internal `session_id`.

Codex already benefits from (1) because broker detach/reconnect is session-type agnostic. The missing piece is (2): when a Codex process has exited and the session is `ended`, mcode cannot currently relaunch that conversation.

This document defines an implementation-ready design for ended-session Codex resume.

## Decision

### Chosen Direction

Add a **Codex-specific persisted identity** (`codex_thread_id`) and implement **resume-in-place** using `codex resume <thread_id>`.

### Why This Is The Cleanest Long-Term Move

This is the best next step because it matches the current shape of the codebase:

- Session lifecycle is already per-agent in behavior even though the PTY plumbing is shared.
- Resume semantics are already "in place" for Claude.
- Claude-specific subsystems are still intentionally explicit: `claude_session_id`, token tracking, input tracking, hook processing, and external session discovery all speak in Claude terms.

Trying to generalize all of that into a fully generic "agent external identity" abstraction now would create broad churn without paying for itself yet.

### Alternatives Considered

#### Option A: Full generic agent identity refactor

Examples:

- replace `claude_session_id` with `external_session_id`
- add `external_session_kind`
- rewrite resume, external import, token tracking, and event storage around that abstraction

Pros:

- cleaner eventual data model if multiple agents need first-class external identity

Cons:

- touches a large amount of stable Claude-specific code
- adds migration and compatibility risk in token/input/event tables
- does not materially improve the first Codex resume delivery

Decision: **not now**

#### Option B: Codex-specific `codex_thread_id` added alongside existing Claude fields

Pros:

- minimal schema churn
- aligns with current explicit `claude_session_id` model
- easiest to test and reason about
- leaves room for a later generic abstraction if the product grows beyond Claude + Codex

Cons:

- duplicates the pattern instead of abstracting it

Decision: **chosen**

#### Option C: Resume heuristically at click time using `codex resume --last`

Pros:

- very low implementation cost

Cons:

- wrong for a multi-session app
- can resume the wrong thread
- breaks user trust

Decision: **reject**

## Goals

- Add ended-session resume for Codex sessions.
- Preserve the existing "resume in place" behavior used by Claude.
- Keep the PTY broker model unchanged.
- Avoid destabilizing Claude-specific tracking systems.

## Non-Goals

- Full Codex hook parity.
- Full generic agent identity abstraction.
- Codex token tracking or input tracking.
- External Codex session import in this phase.

## Current State

- Codex sessions can be created and run in mcode.
- Codex sessions can now run in either `live` or `fallback` hook mode depending on whether the Codex hook bridge is configured successfully at startup.
- Codex state tracking is no longer pure PTY-only:
  - `Stop` and `UserPromptSubmit` can drive session-state transitions through the shared hook state machine
  - transcript paths from hook payloads can be used for follow-up metadata extraction such as model display
- Codex sessions survive app restart through the PTY broker when the PTY is still alive.
- Ended Codex sessions cannot be resumed because:
  - the UI hides resume for Codex
  - `SessionManager.resume()` only supports Claude
  - the schema does not store a Codex-native thread identifier

## Product Semantics

### Reconnect vs Resume

These remain separate behaviors:

- **Reconnect**: the PTY is still alive in the broker; mcode restores the live terminal.
- **Resume**: the process is gone, but Codex's own local state still has the conversation; mcode starts a new PTY with `codex resume <thread_id>`.

### Resume-In-Place

Codex should follow the same UX model as Claude:

- reuse the same internal `session_id`
- keep the same tile and sidebar card
- set the row back to `starting`
- clear `ended_at`
- spawn a new PTY attached to the same internal session record

This is important for consistency with the existing ended-session prompt behavior:

- `Resume Session` revives the existing tile in place
- `Start New Session` creates a brand new internal session and replaces the tile

Codex resume must use the first path, not the second.

## Data Model

### Schema Change

Add a new nullable column:

```sql
ALTER TABLE sessions ADD COLUMN command TEXT;
ALTER TABLE sessions ADD COLUMN codex_thread_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_codex_thread_id
  ON sessions(codex_thread_id)
  WHERE codex_thread_id IS NOT NULL;
```

### Type Changes

Add `codexThreadId: string | null` to `SessionInfo` and the main-process session row type.

Persist the resolved session `command` on create and reuse it on resume instead of hardcoding `codex` or `claude`.

Keep `claudeSessionId` unchanged.

### Why Not Rename `claude_session_id`

Renaming or generalizing that field now would ripple into:

- hook event storage
- token tracking
- input tracking
- Claude external-session import
- docs and tests that are still correctly Claude-specific

That refactor is only justified once more than resume needs to be shared across agents.

## Source Of Truth For Codex Session Identity

### Preferred Source

Use Codex's local state database:

- path pattern: `~/.codex/state_*.sqlite`
- table: `threads`

The local install inspected during design already exposes:

- `id`
- `cwd`
- `title`
- `first_user_message`
- `created_at`
- `updated_at`

This is a better source than `session_index.jsonl` because it has richer matching data.

### Fallback Source

`~/.codex/session_index.jsonl` may be used later for external-session listing, but it is not sufficient as the primary capture source for this feature.

### Why The New Hook Bridge Does Not Replace This

The new Codex hook bridge improves live state handling, but it does not currently provide a durable Codex conversation identifier that mcode can safely use for ended-session resume.

That means the resume design still needs a persisted `codex_thread_id` sourced from Codex's own local session store.

## Capturing `codex_thread_id`

### When Capture Happens

Start capture after a Codex session is spawned.

The capture job runs asynchronously and does not block the terminal from becoming usable.

### Capture Strategy

1. Record the mcode session creation timestamp before spawn.
2. After spawn, poll Codex's local state store for up to 15 seconds.
3. Query `threads` for candidate rows created near the mcode session start.
4. Rank candidates.
5. Persist the chosen `codex_thread_id` onto the session row.

### Candidate Filter

A candidate thread must:

- have `cwd` exactly equal to the mcode session `cwd`
- not already be claimed by another mcode session
- have `created_at` within a recent window around the spawn time

Suggested initial window:

- lower bound: `spawnStartedAt - 5s`
- upper bound: `now + 1s`

### Ranking Rules

Rank candidates in this order:

1. exact `cwd` match and exact `first_user_message === initialPrompt`
2. exact `cwd` match and exact `title === initialPrompt`
3. exact `cwd` match and newest `created_at`

### Ambiguity Rule

If the resolver cannot identify a single high-confidence winner, it must **not guess**.

In that case:

- leave `codex_thread_id` as `NULL`
- log a warning
- the session remains usable, but not resumable

This is preferable to attaching the wrong Codex thread.

### Sessions Without Initial Prompt

Sessions created without `initialPrompt` can still become resumable if the time-window match is unambiguous.

If multiple fresh Codex threads appear in the same `cwd` and there is no prompt to disambiguate them, the session stays non-resumable.

## Main Process Changes

### New Helper

Add a small Codex-state reader module, for example:

- `src/main/codex-session-store.ts`

Responsibilities:

- locate the newest readable `~/.codex/state_*.sqlite`
- query the `threads` table read-only
- return candidate thread records for matching

Keep this intentionally narrow. Do not mix it into `SessionManager`.

### SessionManager Create Flow

For `sessionType === 'codex'`:

1. create the session row as today
2. spawn the PTY as today
3. kick off background thread-id capture
4. if capture succeeds, update `sessions.codex_thread_id`

This should be best-effort. Spawn success must not depend on identity capture success.

### SessionManager Resume Flow

Extend `resume(sessionId, accountId?)` with a Codex branch:

- require `row.session_type === 'codex'`
- require `row.status === 'ended'`
- require `row.codex_thread_id IS NOT NULL`
- accept the existing `accountId?` method parameter for IPC compatibility, but ignore it for Codex
- reset row to `starting`, clear `ended_at`, clear `auto_close`
- spawn:

```typescript
codex resume <codex_thread_id>
```

using the same internal `session_id` and the stored `cwd`

Use the stored `command` so resume follows the original executable path. This keeps custom CLI paths and test fixtures working.

On first data:

- transition to `idle`

On spawn failure:

- revert the row to `ended`

### No Special Broker Changes

The PTY broker already handles Codex sessions the same way it handles Claude sessions. No protocol or broker lifecycle changes are required.

### Relationship To The Existing Codex Hook Bridge

The current Codex hook bridge should remain orthogonal to resume:

- if the bridge is available, resumed Codex sessions can continue using `live` hook mode
- if the bridge is unavailable, resumed Codex sessions must still work in `fallback` mode

Resume must not depend on Codex hook bridge availability.

## Renderer Changes

### Ended Session Prompt

Enable resume for Codex when `codexThreadId` is present.

Behavior:

- Claude resume remains gated by `claudeSessionId`
- Codex resume is gated by `codexThreadId`
- the same button label can be reused: `Resume Session`
- keep the same busy state model (`resuming`, `creating`, shared `busy` disable flag)
- keep the same error rendering model (inline error text under the buttons)
- keep the same success path: `handleResume()` only calls `window.mcode.sessions.resume(...)`; it does **not** replace the tile or create a new session in the renderer

### Error Messaging

Update ended-session copy:

- Claude: "No Claude session ID recorded - cannot resume"
- Codex: "No Codex thread ID recorded - cannot resume"

Optional polish:

- if exit code is `127` for Codex, show a Codex install hint similar to the existing Claude hint

### Preserve Existing Claude-Specific UI Rules

Do not introduce a new Codex-specific prompt layout. Reuse the current pattern in `SessionEndedPrompt`.

Specifically:

- the account selector remains visible only for non-Codex resumable sessions with multiple accounts
- Codex continues to hide the account selector
- the sidebar should use the same resumable-session rule as the ended-session prompt so an ended Codex session without an open tile can still be reopened and resumed in place
- `Start New Session` for Codex remains the existing fresh-session flow:

```typescript
{ cwd: session.cwd, sessionType: 'codex' }
```

- no new button, modal, picker, or extra confirmation step is added for Codex resume

### No Additional Startup Discovery Changes In Phase 1

The startup behavior should remain aligned with current patterns:

- ended sessions still load from SQLite and show their ended prompt
- detached live sessions still restore through broker reconciliation
- external-session discovery remains Claude-only in this phase

Codex resume should not introduce a new startup import/discovery path as part of the initial implementation.

This does **not** forbid the already-existing Codex hook bridge setup at startup. It only means the resume feature should not add a separate Codex import/listing bootstrap path in phase 1.

## IPC Surface

No new IPC method is required.

Keep:

- `session:resume`

Main-process branching on `session_type` is sufficient.

For testability, add a new MCP/devtools tool:

- `session_resume`

This is not a new renderer/main IPC surface. It is only a devtools wrapper around `SessionManager.resume()` so the integration suite can exercise the real resume path without UI-driving hacks.

## Testing

### Unit Tests

Add tests for:

- candidate ranking with exact prompt match
- ambiguous candidates causing no selection
- ignoring already-claimed `codex_thread_id`
- shared renderer resume gating for Claude, Codex, and terminal sessions
- resume guardrails when `codex_thread_id` is missing
- resume guardrails when the session is not `ended`
- Codex resume ignoring `accountId` without mutating Codex session behavior
- `SessionInfo` / test-factory updates so `codexThreadId` is present in typed test fixtures
- resume behavior remaining independent from `hookMode` (`live` vs `fallback`)

Prefer main-process and MCP integration tests over new renderer component-test infrastructure. The repository currently has strong coverage in those layers and no existing DOM/component test harness for `SessionEndedPrompt`.

### Integration Tests

Enhance the fake Codex fixture so it can simulate:

- fresh thread creation
- persistent thread identity
- `resume <thread_id>`

Recommended approach:

- give the fixture a test-only env var pointing to a temporary fake Codex state directory
- on normal launch, the fixture writes a synthetic thread row or JSON record
- on `resume <thread_id>`, the fixture prints argv so the test can assert the correct thread was used
- add a `session_resume` MCP tool so tests can call the real main-process resume path directly

Then add an end-to-end Codex resume suite:

1. create Codex session
2. wait for `codexThreadId` to be captured
3. kill session
4. call resume
5. verify the same mcode `session_id` is returned
6. verify `sessionType` remains `codex`
7. verify `endedAt` is cleared and status transitions `ended -> starting -> idle`
8. verify spawned argv contains `resume <codexThreadId>`
9. verify the visible tile count does not increase on resume
10. verify the sidebar still shows the same session entry rather than a replacement session

Suggested assertions/tools:

- `session_get_status`
- `session_resume`
- `session_wait_for_status`
- `layout_get_tile_count`
- `sidebar_get_sessions`

### Regression Tests

Keep explicit tests that:

- live detach/reconnect for Codex still works
- Claude resume behavior is unchanged
- a Codex session with no captured thread remains non-resumable
- ambiguous Codex thread capture leaves the session non-resumable instead of binding the wrong thread
- `Start New Session` for ended Codex sessions still creates a new internal session and replaces the tile, proving the design keeps resume and new-session as distinct UX paths
- Codex resume works whether the session is in `live` or `fallback` hook mode

### Model Field Behavior

The newly-added session `model` field does not require a separate resume flow.

Resume should follow the existing session-record preservation pattern:

- do not clear `model` when resetting the row to `starting`
- allow the current known model to remain visible
- let later Codex hook/transcript processing update `model` if the resumed session changes it

### Optional Renderer-Facing Verification

If implementation work extracts any pure renderer helper for resume gating or prompt copy, add a small renderer unit test for that helper.

Do not add a broad component-test harness solely for this feature.

## Rollout Plan

### Phase 1

- add schema + type support for `codex_thread_id`
- implement best-effort thread-id capture
- implement Codex resume branch
- enable renderer resume button
- add devtools `session_resume` wrapper for integration coverage
- add tests

### Phase 2

Optional follow-up:

- list/import external Codex sessions from the same Codex state store

This should be a separate slice, not bundled into the first resume delivery.

## Future Evolution

If mcode later adds a third agent with its own persistent conversation identity, revisit the data model and consider a dedicated table such as:

```sql
agent_session_refs (
  mcode_session_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  metadata_json TEXT
)
```

That abstraction is justified only when multiple agents need shared lifecycle, discovery, and analytics semantics. It is not justified by Codex resume alone.

## Summary

The clean long-term move is:

- keep broker reconnect as-is
- add `codex_thread_id`
- capture it from Codex's local state store
- implement `codex resume <thread_id>` as resume-in-place

This delivers the user-facing capability with low architectural risk while keeping the path open for a later generalized agent-identity layer if the product truly grows into needing one.
