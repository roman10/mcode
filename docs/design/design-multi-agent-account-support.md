# Multi-Agent Account Support — Detailed Design Plan

## Overview

`mcode` already has the beginnings of a generic account system:

- sessions persist `accountId`
- account profiles are stored independently from sessions
- agent metadata already has `supportsAccountProfiles`

But the current implementation is still effectively **Claude-only**:

- `AccountManager` hardcodes Claude auth and config paths
- renderer flows show account selection only for Claude sessions
- account verification and subscription usage are Claude-specific
- account identity data is stored in a shape that assumes one email per account profile

This document proposes a phased plan to evolve the current system into a **provider-aware, capability-driven account architecture** that can support other CLI coding agents cleanly.

The plan intentionally includes refactoring and cleanup work because the current Claude-only shortcuts will otherwise create compounding branching debt as more providers are added.

## Recommendation

We **should** support other CLI coding agents with accounts, but we should not do it by incrementally sprinkling more `if (sessionType === ...)` checks into the current system.

The recommended approach is:

1. refactor the current account implementation into a generic foundation
2. migrate Claude onto the new abstraction without changing Claude behavior
3. add support for the next provider through the abstraction
4. use the same abstraction to evaluate and add later providers

Recommended rollout order:

1. **Claude migration to generic architecture** — required foundation
2. **Copilot account support** — best next candidate
3. **Gemini account support** — good candidate after verification
4. **Codex account support** — do only after CLI/auth semantics are verified and the product value is still compelling

## Why support multi-agent accounts

### Pros

- Lets users keep separate authenticated identities per provider and per workflow
- Reduces auth collisions when multiple sessions run in parallel
- Makes account isolation a first-class product capability rather than a Claude-only exception
- Brings the account system in line with the rest of the app, which already treats agents as first-class peers
- Creates a reusable extension point for future providers

### Cons

- Each provider has different auth, config, and quota semantics
- The current account UI is too simple for multi-provider state
- Data model changes are needed to avoid storing provider-specific identity on the generic account profile
- Testing surface grows substantially
- Ongoing maintenance cost increases with each supported provider

## Current State

### What is already generic

- `src/shared/types.ts`
  - `SessionInfo.accountId`
  - `SessionCreateInput.accountId`
  - `AccountProfile` as a top-level concept
- `db/migrations/013_account_profiles.sql`
  - `account_profiles`
  - `sessions.account_id`
- `src/shared/session-agents.ts`
  - `supportsAccountProfiles` is already an agent capability flag
- `src/main/session/session-manager.ts`
  - session creation and resume already accept an `accountId`

### What is still Claude-specific (pre-Phase 1)

> **Note:** `account-manager.ts` was deleted in Phase 1. The issues below are resolved — see Phase 1 completion notes.

- ~~`src/main/account-manager.ts`~~
  - ~~`claude auth status --json`~~
  - ~~`CLAUDE_CONFIG_DIR`~~
  - ~~`.claude` directory assumptions~~
  - ~~`CLAUDE_SHARED_SUBDIRS`~~
  - ~~Claude-only subscription usage fetcher~~
- `src/renderer/components/Sidebar/NewSessionDialog.tsx`
  - account selection is gated by the Claude dialog path
- `src/renderer/components/AccountsDialog.tsx`
  - account verification copy assumes Claude
  - one-email-per-account assumption does not work well across providers

## Core Design Direction

The right long-term model is:

- **account profile** = an isolated home/workspace identity container managed by mcode
- **provider account state** = provider-specific auth/identity/config state attached to an account profile

That means one account profile may contain:

- Claude auth state
- Copilot auth state
- Gemini auth state
- Codex auth state

This keeps the product mental model simple:

- users select one account profile when launching a session
- the session type determines which provider-specific identity is relevant inside that isolated account home

## Architectural Problems To Fix First

### Problem A — `AccountProfile` stores Claude-shaped identity

Today `AccountProfile` includes `email`, which is treated as the verified identity for the account. That is workable for Claude-only support, but it becomes wrong once an account may have different authenticated identities per provider.

**Plan**

- keep `account_profiles` as the top-level account container
- move provider-specific identity/auth data into a new table
- treat `account_profiles.email` as transitional legacy state only during migration

### Problem B — `AccountManager` owns too many responsibilities (RESOLVED)

> **Resolved in Phase 1.** `account-manager.ts` (413 lines) was deleted and replaced by focused modules under `src/main/accounts/`.

~~`src/main/account-manager.ts` currently does all of the following:~~

- ~~persistence for account profiles~~
- ~~isolated-home filesystem setup~~
- ~~provider config directory assumptions~~
- ~~auth-status execution~~
- ~~subscription usage fetching~~
- ~~IPC handler registration~~

**Plan**

- ~~split `AccountManager` into focused modules~~ — done
- ~~keep one thin orchestration layer if needed~~ — done (`AccountService`)

### Problem C — UI behavior is type-checked instead of capability-driven

The new-session flow and account UI still rely on Claude-specific assumptions instead of asking what the selected provider supports.

**Plan**

- move account-related UI decisions behind shared capability helpers
- stop using `Claude` as the implicit proxy for `supports accounts`

### Problem D — provider-specific operational logic is not isolated

Auth commands, config paths, shared directories, install help, and quota support should be declared in one provider-owned place, not scattered across renderer and main process code.

**Plan**

- introduce a provider account adapter/registry
- make the rest of the system depend on that registry

## Proposed Architecture

### 1. Introduce a provider account adapter

Add a new abstraction in main process code, for example under:

- `src/main/accounts/account-provider.ts`
- `src/main/accounts/account-provider-registry.ts`
- `src/main/accounts/providers/claude-account-provider.ts`
- `src/main/accounts/providers/copilot-account-provider.ts`
- `src/main/accounts/providers/gemini-account-provider.ts`
- `src/main/accounts/providers/codex-account-provider.ts`

Suggested interface:

See **Phase 0 — Revised Adapter Interface (Post-Discovery)** below for the finalized interface. Key design principles:

- provider logic lives with the provider
- `AccountManager` no longer knows Claude internals
- all methods are required (no optional `?` suffix) — providers implement no-ops where not applicable
- `getConfigEnv()` is the critical method — each provider has different isolation env var semantics (see Phase 0 findings)
- `checkCliInstalled()` is per-provider (currently hardcoded to Claude in the sidebar banner)

### 2. Split account infrastructure into clear layers

Suggested module split:

- `AccountProfileRepository`
  - CRUD for `account_profiles`
- `AccountHomeManager`
  - create/sync/delete isolated homes
  - generic symlink policy
- `AccountIdentityRepository`
  - provider-specific auth/identity state
- `AccountService`
  - orchestration layer used by IPC and session manager
- `AccountProviderRegistry`
  - maps agent type to provider adapter

This decomposition makes future providers much easier to add and test independently.

### 3. Move from profile-level identity to provider-level identity

Add a new table, e.g.:

```sql
CREATE TABLE account_provider_identities (
  account_id TEXT NOT NULL,
  session_type TEXT NOT NULL,
  auth_status TEXT NOT NULL,
  identity TEXT,          -- email for Claude/Gemini, GitHub username for Copilot, auth mode for Codex
  display_name TEXT,
  last_checked_at TEXT,
  last_authenticated_at TEXT,
  metadata_json TEXT,
  PRIMARY KEY (account_id, session_type),
  FOREIGN KEY (account_id) REFERENCES account_profiles(account_id) ON DELETE CASCADE
);
```

This table should be the source of truth for provider-specific auth state.

Potential follow-up table if quota/subscription data needs persistence:

```sql
CREATE TABLE account_provider_usage_cache (
  account_id TEXT NOT NULL,
  session_type TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (account_id, session_type),
  FOREIGN KEY (account_id) REFERENCES account_profiles(account_id) ON DELETE CASCADE
);
```

### 4. Generalize isolated-home setup

The isolated-home mechanism is still useful, but it should become provider-agnostic.

Refactor `setupAccountDirectory()` and related code to support:

- a generic denylist of config dirs that must remain isolated
- provider-declared shared subdirs inside the provider config directory
- provider-declared config env vars

Suggested concept:

- shared account home mirrors the user home via symlinks
- provider config directories are isolated per account
- selected provider subdirectories can be shared from the primary account only if explicitly declared safe

#### Multi-provider isolation model

The config dir denylist is **additive**: each registered provider declares its config dir path via `getConfigDirName()`, and the home manager unions them into a single denylist. Per Phase 0 findings, the denylist is: `.claude/`, `.copilot/`, `.gemini/`, `.codex/`.

**Important caveat from Phase 0:** HOME override does NOT work for all providers (Copilot breaks on macOS due to Keychain). The isolated-home directory is still valuable for symlinking general HOME content, but session env must use provider-specific config env vars (via `getConfigEnv()`) rather than relying solely on HOME override. For Copilot specifically, the session env should set `COPILOT_HOME` but may still set `HOME` for Claude/Codex which need it.

Implications:

- **Existing account homes**: when a new provider is registered (e.g., Copilot support ships), existing account home directories will not yet have the new provider's config dir isolated. The `syncSymlinks()` method must be extended to apply the current denylist on resync, creating isolated config dirs for newly registered providers.
- **Resync trigger**: `syncSymlinks()` should be called on app startup or account use, not just account creation, to handle this case.
- **Provider removal**: if a provider is deregistered, its isolated config dir can remain in the account home without harm (no cleanup needed).

### 5. Make renderer account UX provider-aware

The renderer needs to distinguish between:

- selecting an account profile for a session
- verifying provider auth status for an account profile

That implies:

- account selector should appear for any agent where `supportsAccountProfiles === true`
- account rows should show status by provider, not a single global email
- verification/help text should use provider metadata, not hardcoded Claude strings

## Proposed Shared-Type Changes

### `AccountProfile`

Keep it generic and container-focused:

```ts
interface AccountProfile {
  accountId: string;
  name: string;
  isDefault: boolean;
  homeDir: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}
```

Remove or deprecate:

- `email`

### Align `AuthStatusResult` for multi-provider use

The current `AuthStatusResult` has `email?: string`, which is Claude-centric. For Copilot the identity is a GitHub username (`waterdrop86`), for Codex it may be "ChatGPT" (OAuth mode) or masked API key. Rename to be provider-neutral:

```ts
interface AuthStatusResult {
  status: CliAuthStatus;
  identity?: string;      // was `email` — now holds whatever the provider reports (email, username, mode)
  displayName?: string;    // optional human-friendly label
}
```

### Add provider-scoped identity types

```ts
interface AccountProviderIdentity {
  accountId: string;
  sessionType: AgentSessionType;
  authStatus: CliAuthStatus;
  identity: string | null;     // email for Claude/Gemini, GitHub username for Copilot, auth mode for Codex
  displayName: string | null;
  lastCheckedAt: string | null;
  lastAuthenticatedAt: string | null;
}
```

For renderer convenience:

```ts
interface AccountProfileWithProviders extends AccountProfile {
  providers: Partial<Record<AgentSessionType, AccountProviderIdentity>>;
}
```

## Proposed IPC And API Changes

Current IPC shape is too Claude-specific because account operations are not parameterized by provider.

### Profile-level calls (unchanged)

- `account:list`
- `account:create`
- `account:rename`
- `account:delete`

### Provider-aware calls (replace existing Claude-specific calls in-place)

Since this is an internal Electron IPC contract (not a public API), both main and renderer are updated in the same commit. No deprecation period is needed.

- `account:get-auth-status(accountId)` → `account:get-provider-auth-status(accountId, sessionType)`
- `account:open-auth-terminal(accountId)` → `account:open-auth-terminal(accountId, sessionType)`
- `account:get-subscription-usage(accountId, force)` → `account:get-provider-usage(accountId, sessionType, force)`
- `account:check-cli-installed()` → `account:check-provider-installed(sessionType)`

### New calls

- `account:list-provider-identities(accountId?)`

Update the renderer, preload, IPC contract, and main handlers together in Phase 3. No compatibility wrappers needed.

## Refactoring And Cleanup Plan

These refactors should be treated as part of the project, not optional polish.

### R1 — Move agent-specific account capabilities into shared metadata

Extend `AgentDefinition` or add a nearby capability helper so renderer and main process can ask:

- does this provider support account profiles
- does this provider support provider-specific auth verification
- does this provider expose usage/quota data
- what install URL should be shown

This avoids duplicating provider checks in UI components.

### R2 — Replace `isClaude` account gating in `NewSessionDialog`

Current issue:

- account selection is only shown in the Claude path

Refactor:

- use `supportsAccountProfiles`
- show account selection for any eligible provider
- keep Claude-only fields such as effort/worktree separate from account support

### R3 — Split `AccountManager` (COMPLETED)

Delivered in Phase 1. Final shape:

- `src/main/accounts/account-profile-repository.ts` — DB CRUD
- `src/main/accounts/account-home-manager.ts` — filesystem isolation
- `src/main/accounts/account-service.ts` — orchestration layer
- `src/main/accounts/account-ipc.ts` — IPC handlers
- `src/main/accounts/account-provider.ts` — adapter interface + registry
- `src/main/accounts/providers/claude-account-provider.ts` — Claude adapter
- `src/main/accounts/index.ts` — barrel exports
- `account-identity-repository.ts` deferred to Phase 2

### R4 — Extract filesystem sync policy (COMPLETED)

Delivered in Phase 1:

- symlink denylist is now provider-driven via `registry.getAllConfigDirNames()`
- shared subdirs are per-provider via `adapter.getSharedConfigSubdirs()`
- explicit logging for skipped or failed sync actions

### R5 — Tighten auth error handling

Current issue:

- non-ENOENT failures in auth status checks collapse into `not-authenticated`

That is acceptable for initial Claude UX, but not great long-term.

Refactor:

- classify parse failures, unsupported CLI output, and command execution failures separately in logs
- keep user-facing status simple if desired, but improve diagnostics

### R6 — Remove provider-shaped data from generic UI store state

Current issue:

- account store and account dialogs assume one auth status and one email per account

Refactor:

- make account store provider-aware
- keep provider status caches keyed by `(accountId, sessionType)`

### R7 — Unify provider help and auth-launch behavior

Install/help links and auth-launch behavior should come from provider metadata/adapters, not hand-written strings in `AccountsDialog`.

### R8 — Consolidate account-related tests

Create a clear test layout:

- unit tests for repositories
- unit tests for provider adapters
- unit tests for isolated-home management
- renderer tests for account selection and verification UI
- integration tests for account-backed session creation and resume

## Phased Delivery Plan

## Phase 0 — Discovery And Contract Definition (COMPLETED)

### Goals

- verify auth/config semantics for Copilot, Gemini, and Codex
- define the provider adapter interface
- define the migration contract for existing Claude accounts

### Provider Capability Matrix

| | Claude | Copilot | Gemini | Codex |
|---|---|---|---|---|
| **Config dir path** | `~/.claude/` | `~/.copilot/` | `~/.gemini/` | `~/.codex/` |
| **Config env var** | `CLAUDE_CONFIG_DIR` | `COPILOT_HOME` | `GEMINI_CLI_HOME` | `CODEX_HOME` |
| **Env var semantics** | Points to config dir directly | Points to config dir directly | Points to **parent** dir (config at `$VAR/.gemini/`) | Points to config dir directly |
| **Auth status command** | `claude auth status --json` | None (read `config.json`) | None (read `google_accounts.json`) | `codex login status` |
| **Auth status output** | JSON (`email`, `authenticated`) | N/A — parse `logged_in_users` array in `$COPILOT_HOME/config.json` | N/A — parse `active` field in `$GEMINI_CLI_HOME/.gemini/google_accounts.json` | Plain text, exit code 0=ok / 1=not authenticated |
| **Login command** | `claude auth login` (standalone) | `copilot login` (standalone) | `/auth` (**REPL-only**, no standalone) | `codex login` (standalone) |
| **Login flags** | — | `--config-dir <dir>` | — | `--with-api-key` (stdin), `--device-auth` |
| **HOME isolation works?** | Yes | **No** — breaks macOS Keychain lookup | Yes (but keychain auth shared) | Yes |
| **Dedicated config env var works?** | Yes | Yes | Yes | Yes |
| **Auth storage** | macOS Keychain (`Claude Code-credentials-*`) + `.credentials.json` fallback | macOS Keychain (`copilot-cli`) + plaintext fallback in config dir | macOS Keychain (`gemini-cli-oauth`) + encrypted file fallback (`gemini-credentials.json`) | `auth.json` in config dir + keyring fallback |
| **Keychain isolation concern** | Keychain entry keyed by config dir hash — **fully isolated** | Keychain entry keyed by `host:username` — **shared across accounts** | Keychain entry keyed by fixed `main-account` — **shared across accounts** | Uses file-based `auth.json` by default — **fully isolated** |
| **Shared subdirs (safe to symlink)** | `commands/`, `skills/`, `plugins/`, `projects/` | None identified (hooks/ is mcode-managed) | None identified (settings.json is per-instance) | `rules/`, `skills/`, `memories/` (candidates, needs verification) |
| **Usage/quota API** | Yes (OAuth endpoint) | No | No | No |
| **Install check** | `which claude` | `which copilot` | `which gemini` | `which codex` |

### Key Architectural Findings

#### Finding 1 — HOME override does NOT work for Copilot

Copilot stores auth tokens in the macOS Keychain. The Keychain is located at `$HOME/Library/Keychains/login.keychain-db`. When mcode overrides `HOME` for a secondary account, Keychain lookups fail and Copilot reports "No authentication information found."

**Decision:** For Copilot, use `COPILOT_HOME` env var for config isolation instead of `HOME` override. The current mcode approach (HOME override + symlinks) must be adapted to support provider-specific isolation env vars.

#### Finding 2 — Gemini keychain auth is NOT account-isolated

Gemini uses `keytar` with a fixed service name (`gemini-cli-oauth`) and fixed account name (`main-account`). All Gemini instances share the same Keychain entry regardless of `GEMINI_CLI_HOME`. To achieve full auth isolation, set `GEMINI_FORCE_FILE_STORAGE=true` to force encrypted file-based storage at `$GEMINI_CLI_HOME/.gemini/gemini-credentials.json`.

**Decision:** When spawning Gemini sessions under a secondary account, inject `GEMINI_FORCE_FILE_STORAGE=true` alongside `GEMINI_CLI_HOME` to ensure auth isolation.

#### Finding 3 — Gemini login is REPL-only

There is no `gemini auth login` standalone command. The `/auth` command only works inside the Gemini REPL. This means the current mcode auth flow (open a terminal running `claude auth login`) must be adapted: for Gemini, open a Gemini REPL session and instruct the user to run `/auth`.

**Decision:** The adapter's `buildAuthTerminalInput()` method must support launching a REPL session (not just a standalone auth command). For Gemini, this means launching `gemini` and letting the user run `/auth` interactively.

#### Finding 4 — Config env var semantics are inconsistent

Three providers point the env var directly to the config dir:
- `CLAUDE_CONFIG_DIR=/path/.claude` → config at `/path/.claude/`
- `COPILOT_HOME=/path/.copilot` → config at `/path/.copilot/`
- `CODEX_HOME=/path/.codex` → config at `/path/.codex/`

Gemini is the exception:
- `GEMINI_CLI_HOME=/path` → config at `/path/.gemini/`

**Decision:** The adapter must declare how its env var maps to the actual config directory path. The home manager cannot assume a uniform pattern.

#### Finding 5 — Auth status detection is non-uniform

Only Claude provides machine-readable auth status (JSON). Codex has a command but output is plain text. Copilot and Gemini have no auth status command at all and require reading config files.

**Decision:** The adapter's `checkAuthStatus()` is fully provider-implemented. No shared "run command and parse" helper. Each provider implements its own detection logic:
- **Claude:** parse `claude auth status --json` output
- **Copilot:** read `$COPILOT_HOME/config.json`, check `logged_in_users` array
- **Gemini:** read `$GEMINI_CLI_HOME/.gemini/google_accounts.json`, check `active` field
- **Codex:** run `codex login status`, check exit code (0 = ok), parse text for email/mode

#### Finding 6 — Copilot keychain entries are host-scoped, not dir-scoped

Copilot stores Keychain entries as `copilot-cli` service with account `host:username` (e.g., `https://github.com:waterdrop86`). Multiple mcode account profiles using the same GitHub identity will share the same Keychain credential. This is acceptable — different accounts using the same GitHub login don't need separate tokens.

However, if a user wants to use **different GitHub identities** per mcode account, they need to run `copilot login` separately in each account's environment. The `--config-dir` flag on `copilot login` ensures the `config.json` (which records `logged_in_users`) is written to the correct location. The Keychain entry will be a new `host:different_username` entry.

**Decision:** This is workable. Each account's `COPILOT_HOME` gets its own `config.json` with its own `logged_in_users`. Keychain entries are naturally separated by GitHub username.

### Revised Adapter Interface (Post-Discovery)

```ts
interface AccountProviderAdapter {
  readonly sessionType: AgentSessionType;
  readonly supportsAccountProfiles: boolean;

  /** Config dir name relative to home (e.g., '.claude', '.copilot'). */
  getConfigDirName(): string;

  /**
   * Return env vars to isolate this provider under an account home.
   * Called by AccountHomeManager when spawning a session.
   *
   * Each provider has different semantics:
   * - Claude: { CLAUDE_CONFIG_DIR: `${accountHome}/.claude` }
   * - Copilot: { COPILOT_HOME: `${accountHome}/.copilot` }
   * - Gemini: { GEMINI_CLI_HOME: accountHome, GEMINI_FORCE_FILE_STORAGE: 'true' }
   * - Codex: { CODEX_HOME: `${accountHome}/.codex` }
   */
  getConfigEnv(accountHome: string): Record<string, string>;

  /** Subdirs inside the config dir that are safe to symlink from the primary account. */
  getSharedConfigSubdirs(): readonly string[];

  /** Check if the CLI binary is installed and available. */
  checkCliInstalled(): Promise<CliAuthStatus>;

  /**
   * Check auth status for a specific account.
   * Implementation varies per provider (CLI command, config file read, etc.).
   */
  checkAuthStatus(account: AccountProfile): Promise<AuthStatusResult>;

  /**
   * Build the terminal session input for authenticating this provider.
   * Returns null if the provider does not support terminal-based auth.
   *
   * For Gemini: launches a REPL session (user runs /auth interactively).
   * For others: launches a standalone login command.
   */
  buildAuthTerminalInput(account: AccountProfile): SessionCreateInput | null;

  /** URL to show when the CLI is not installed. */
  getInstallHelpUrl(): string | undefined;

  /** Whether this provider supports subscription/quota display. */
  supportsSubscriptionUsage(): boolean;

  /** Fetch subscription/usage data. Only called if supportsSubscriptionUsage() is true. */
  getSubscriptionUsage(account: AccountProfile, force?: boolean): Promise<SubscriptionUsage | null>;
}
```

Key changes from the draft interface:
- All methods are **required** (no optional `?` suffix). Providers implement no-ops where not applicable (e.g., `getSharedConfigSubdirs()` returns `[]`).
- `getConfigEnv()` is required — every provider must declare its isolation env vars.
- `getConfigDirName()` returns `string` (not `string | null`) — every supported provider has a config dir.
- `buildAuthTerminalInput()` returns `null` instead of being optional — cleaner null-check at one call site.
- Added doc comments explaining the per-provider semantics.

### Provider Readiness Assessment

| Provider | Readiness | Recommendation |
|----------|-----------|----------------|
| **Copilot** | **Ready.** Config isolation via `COPILOT_HOME` is well-supported. Auth detection via `config.json` parsing is reliable. Login via `copilot login --config-dir` works. | Ship in Phase 5. |
| **Gemini** | **Ready with caveats.** Config isolation via `GEMINI_CLI_HOME` + `GEMINI_FORCE_FILE_STORAGE=true` works. Auth detection via file read works. Login is REPL-only (UX friction). | Ship in Phase 6. REPL-based auth is acceptable but should be clearly communicated in the UI. |
| **Codex** | **Ready with caveats.** Config isolation via `CODEX_HOME` works. `HOME` override also works. Auth status via `codex login status` is coarse (exit code + text only). No usage/quota API. | Defer to Phase 7 decision gate. Lower user value vs. implementation cost. |

### Migration Contract for Existing Claude Accounts

No data migration needed for Claude accounts:
- Existing `account_profiles` rows remain valid.
- `email` column becomes transitional — will be backfilled into `account_provider_identities` (Claude provider) in Phase 2.
- Existing account home directories (with `.claude/` isolation and symlinks) continue to work.
- `getSessionEnv()` for Claude returns `{ HOME, CLAUDE_CONFIG_DIR }` — same as today, now routed through the adapter.

### Exit Criteria (all met)

- We can implement Claude migration without unresolved model questions — **yes**
- We have enough verified information to prioritize providers — **yes** (Copilot > Gemini > Codex)
- The adapter interface is finalized based on actual provider semantics — **yes**

## Phase 1 — Foundation Refactor Without Behavior Change (COMPLETED)

### Goals

- make the current Claude implementation run through the new architecture
- preserve current product behavior

### Work

- ~~introduce repositories and service split~~ — done
- ~~add provider adapter registry~~ — done
- ~~move Claude auth/config/subscription logic into `claude-account-provider.ts`~~ — done
- ~~move home/symlink logic into `account-home-manager.ts`~~ — done
- ~~**generalize `getSessionEnv()`**~~ — done: delegates to provider adapter's `getConfigEnv()`. Fallback for terminal/unknown session types merges env from all registered adapters (Phase 1: only Claude registered, so output is identical to before).
- ~~**generalize home isolation denylist**~~ — done: `setupAccountDirectory()` queries `registry.getAllConfigDirNames()` for the union of all registered provider config dirs.
- ~~**make hook reconciliation account-aware**~~ — done (preparation): hook bridge `configPath` now accepts optional `configDir` parameter. Copilot, Gemini, and Codex hook configs updated to accept the override. No callers use the override yet in Phase 1 — active reconciliation for secondary accounts will be wired in Phase 5/6.
- ~~keep existing IPC API shape for now (updated in Phase 3)~~ — done

### Deliverables

- ~~cleaner module boundaries~~ — done
- ~~`getSessionEnv()` delegates to provider adapter (not hardcoded to Claude)~~ — done
- ~~home isolation uses provider-declared denylist~~ — done
- ~~hook reconciliation accepts a config dir path (account-aware)~~ — done (signature only; callers in Phase 5/6)
- ~~Claude still works exactly as before~~ — verified (934 tests passing, `tsc --noEmit` clean)
- ~~no renderer behavior change yet~~ — confirmed

### Implementation Notes

**New files:**
- `src/main/accounts/account-provider.ts` — `AccountProviderAdapter` interface + `AccountProviderRegistry` class
- `src/main/accounts/account-profile-repository.ts` — DB CRUD extracted from AccountManager
- `src/main/accounts/account-home-manager.ts` — filesystem isolation with provider-driven denylist
- `src/main/accounts/account-service.ts` — thin orchestration layer replacing AccountManager
- `src/main/accounts/account-ipc.ts` — IPC handlers (unchanged channel names/behavior)
- `src/main/accounts/providers/claude-account-provider.ts` — Claude adapter implementation
- `src/main/accounts/index.ts` — barrel exports

**Deleted files:**
- `src/main/account-manager.ts` (413 lines) — fully replaced, no re-export shim

**Modified files (3 import-site updates):**
- `src/main/index.ts` — new instantiation with registry pattern
- `src/main/session/session-manager.ts` — `AccountService` type, `sessionType` passed to `getSessionEnv()`
- `src/devtools/types.ts` — `AccountService` type

**Modified files (hook bridge preparation):**
- `src/main/hooks/hook-bridge.ts` — `configPath(configDir?)`, `reconcile(configDir?)`, `cleanup(configDir?)`
- `src/main/hooks/copilot-hook-config.ts` — `configPath` accepts optional override
- `src/main/hooks/gemini-hook-config.ts` — `configPath` accepts optional override
- `src/main/hooks/codex-hook-config.ts` — `configPath` accepts optional override

**Tests (49 new, 934 total):**
- `tests/unit/main/accounts/account-provider-registry.test.ts` (6 tests)
- `tests/unit/main/accounts/claude-account-provider.test.ts` (8 tests)
- `tests/unit/main/accounts/account-profile-repository.test.ts` (12 tests)
- `tests/unit/main/accounts/account-home-manager.test.ts` (5 tests)
- `tests/unit/main/accounts/account-service.test.ts` (12 tests)

**Known Phase 1 limitations (by design):**
- `AccountService.getAuthStatus()` hardcodes `registry.get('claude')` — will be parameterized by provider type in Phase 3+
- `account-ipc.ts` imports `fetchSubscriptionUsage` directly — matches original pattern
- `.claude/settings.json` copy in `setupAccountDirectory` is Claude-specific — will generalize in Phase 5+
- `getAllSettingsPaths` only handles Claude settings paths — same scope

### Why this phase matters

Without this step, every new provider will widen a file that is already too central and too Claude-shaped.

## Phase 2 — Data Model Migration

### Goals

- support provider-specific identity and usage state
- keep existing user data intact

### Work

- add `account_provider_identities`
- defer `account_provider_usage_cache` — current in-memory caching with 5-minute TTL in `claude-subscription-fetcher.ts` is sufficient. Only add the table if a concrete need arises (e.g., offline quota display, multiple processes needing shared cache)
- migrate current Claude email state from `account_profiles.email` into provider-scoped identity rows
- keep `account_profiles.email` as a fallback during transition if needed
- add indexes for `(account_id, session_type)`

### Deliverables

- provider-scoped identity model
- migration and backfill logic

### Exit criteria

- renderer can query provider status without using `account_profiles.email`

## Phase 3 — Renderer And IPC Modernization

### Goals

- make account UX capability-driven and provider-aware

### Work

- update preload and IPC contracts with provider-aware methods
- update `accounts-store.ts` to cache provider-specific identity state
- update `AccountsDialog.tsx` to show provider-aware verification rows
- update `NewSessionDialog.tsx` to show account selection for all supported providers
- update ended-session resume prompts to stay capability-driven

### UX direction

**AccountsDialog layout:**

- top-level account profile list remains the same (default account, then secondary accounts)
- each account row shows the account name and a summary line (e.g., "Claude: ok · Copilot: not verified")
- clicking an account expands it to show per-provider status rows:
  - one row per provider where `supportsAccountProfiles === true`
  - each row shows: provider icon + name, auth status badge (green/amber/red), identity text (email/username), and a Verify/Login action button
  - providers where CLI is not installed show an Install link instead of Verify
- verify/login actions are scoped to the clicked provider row
- the "Add Account" flow remains the same (creates profile, then user can verify per provider)

**NewSessionDialog:**

- account selector dropdown appears for any agent where `supportsAccountProfiles === true` and `accounts.length > 1` (same gating logic as today, just not Claude-specific)
- each option shows: account name + provider-specific identity (e.g., "Work — waterdrop86" for Copilot, "Work — user@example.com" for Claude)
- if the selected account has no verified identity for the chosen provider, show a subtle warning but allow session creation

### Deliverables

- renderer no longer assumes Claude-only accounts
- provider-aware IPC contract in place

## Phase 4 — Claude Migration Hardening

### Goals

- ensure Claude behavior remains stable after the refactor
- remove compatibility debt introduced in earlier phases

### Work

- convert remaining Claude-only callers to provider-aware APIs
- stop reading `account_profiles.email` directly in renderer code
- tighten tests around isolated `.claude` config handling
- verify subscription usage still works through the adapter

### Deliverables

- Claude fully running on the new abstraction
- compatibility shims minimized

## Phase 5 — Copilot Account Support

### Why Copilot first

Copilot is the best next candidate because:

- the app already has mature Copilot runtime support
- Copilot is already a first-class session type
- user value is high
- the architecture work done for Claude maps relatively well to Copilot

### Goals

- allow Copilot sessions to select account profiles
- verify/login Copilot per account
- isolate Copilot config state per account

### Work

- implement `copilot-account-provider.ts` with:
  - `getConfigEnv()` → `{ COPILOT_HOME: ‘${accountHome}/.copilot’ }` (**not** HOME override — breaks macOS Keychain)
  - `checkAuthStatus()` → read `$COPILOT_HOME/config.json`, parse `logged_in_users` array
  - `buildAuthTerminalInput()` → launch `copilot login --config-dir ${accountHome}/.copilot`
  - `getSharedConfigSubdirs()` → `[]` (hooks/ is mcode-managed, no user-content subdirs identified)
  - `getConfigDirName()` → `’.copilot’`
- enable `supportsAccountProfiles` for Copilot only after the adapter is complete
- wire provider-aware auth verification and auth terminal launch
- no usage/quota display (Copilot uses GitHub subscription billing, no API)

### Deliverables

- Copilot account-backed sessions
- renderer support for Copilot account selection and verification

### Risks

- ~~auth flow may not mirror Claude closely~~ → **resolved:** `copilot login --config-dir` works for per-account auth
- Copilot hook bridge (`~/.copilot/hooks/hooks.json`) is currently written to the real `~/.copilot/`. For secondary accounts, it must be written to `$COPILOT_HOME/hooks/hooks.json` instead. The hook reconciliation system needs to be account-aware.

## Phase 6 — Gemini Account Support

### Goals

- enable account-backed Gemini sessions on top of the same infrastructure

### Work

- implement `gemini-account-provider.ts` with:
  - `getConfigEnv()` → `{ GEMINI_CLI_HOME: accountHome, GEMINI_FORCE_FILE_STORAGE: ‘true’ }` (force file storage to avoid shared Keychain)
  - `checkAuthStatus()` → read `$GEMINI_CLI_HOME/.gemini/google_accounts.json`, check `active` field
  - `buildAuthTerminalInput()` → launch `gemini` REPL session (user runs `/auth` interactively). Show instructional text in the UI: "Run /auth in the Gemini session to authenticate."
  - `getSharedConfigSubdirs()` → `[]` (no user-content subdirs identified)
  - `getConfigDirName()` → `’.gemini’`
- support account selection in session creation

### Deliverables

- Gemini account support with file-based auth isolation

### Risks

- REPL-only login (`/auth`) means the auth UX is less guided than Claude/Copilot — cannot auto-detect completion easily. Consider polling `google_accounts.json` for `active` field changes as a completion signal.
- `GEMINI_CLI_HOME` env var semantics differ from other providers (points to parent dir, not config dir itself). The adapter must handle this correctly.

## Phase 7 — Codex Account Support Decision

Codex should be treated as a gated follow-up, not an automatic final step.

### Phase 0 findings for Codex

- `CODEX_HOME` env var works for config isolation (points directly to config dir)
- `HOME` override also works (Codex uses `$HOME/.codex/`)
- `codex login status` provides exit-code-based auth detection (0=ok, 1=not authenticated)
- `codex login` works as a standalone login command
- Auth stored in `auth.json` (file-based by default) — naturally isolated per `CODEX_HOME`
- No usage/quota API

### Decision criteria

- ~~verified isolated-home behavior~~ → **verified**, works
- ~~reliable auth status detection~~ → **verified**, exit code is reliable (text parsing is fragile but unnecessary)
- clear user value relative to implementation cost
- acceptable maintenance footprint

### Possible outcomes

- full account support (technically feasible per Phase 0 findings)
- explicit deferral if user value doesn’t justify the maintenance cost

## Suggested Testing Plan

### Unit tests

- account profile repository CRUD
- account provider identity repository CRUD
- account home setup and resync behavior
- provider adapters for Claude, Copilot, Gemini, Codex
- auth error classification

### Renderer tests

- new-session dialog shows account selector based on `supportsAccountProfiles`
- provider verification UI updates the correct provider row
- install/help copy is provider-specific
- session resume override remains valid

### Integration tests

- create session with non-default account for Claude
- create session with non-default account for Copilot
- create session with non-default account for Gemini
- verify account deletion guards still work when provider identities exist
- verify session resume respects selected account profile

### Migration tests

- existing DB with only Claude account rows migrates correctly
- `account_profiles.email` backfills into Claude provider identity rows (as `identity` column)
- old IPC callers still behave during transition

## Product And UX Decisions

The following product decisions should be made explicitly during implementation:

### 1. Should one account profile be reusable across all providers

Recommendation:

- **yes**
- an account profile should stay a generic isolated-home container
- provider-specific auth lives beneath that container

This keeps the mental model simple and avoids multiplying visible account concepts.

### 2. Should account selection be hidden when the selected provider has no verified identity

Recommendation:

- **no**
- allow selection, but clearly show verification status
- let the user verify from the account UI or from a contextual action

### 3. Should every provider expose usage/quota in the Accounts dialog

Recommendation:

- **no, not initially**
- make usage/quota capability-driven and optional
- keep Claude support
- add others only when their APIs are stable and useful

### 4. Should the default account remain special

Recommendation:

- **yes**
- default account should continue to mean “real user home, no HOME override”
- non-default accounts should continue to mean “isolated account home”

## Risks

### Technical risks

- ~~provider auth commands may not be stable or machine-readable~~ → **confirmed in Phase 0**: Copilot and Gemini have no auth status command; adapters read config files instead. Codex has exit-code-only output. Mitigated by fully provider-implemented `checkAuthStatus()`.
- ~~isolated-home assumptions may fail for some CLIs~~ → **confirmed in Phase 0**: HOME override breaks Copilot (macOS Keychain). Mitigated by using provider-specific config env vars (`COPILOT_HOME`, `GEMINI_CLI_HOME`, `CODEX_HOME`).
- user-scoped hook/plugin/config directories need provider-specific handling — hook reconciliation must be account-aware (added to Phase 1 work)
- migration complexity increases if renderer keeps reading legacy fields for too long

### Product risks

- account UI may become noisy if every provider exposes separate status/actions
- users may expect provider parity before it is actually implemented
- the team may overbuild quota/subscription support before the core account flow is solid

## Explicit Non-Goals For The First Implementation

- unified cross-provider quota dashboard parity
- sharing provider credentials across account profiles
- building provider-specific advanced management beyond login/status/install help
- solving every provider’s advanced configuration UX in the first release

## Implementation Order Summary

### Must-do first

1. ~~split the current account system into cleaner modules~~ — done (Phase 1)
2. ~~add provider adapter registry~~ — done (Phase 1)
3. add provider-scoped identity persistence
4. migrate Claude to the new foundation

### Then do

5. modernize IPC and renderer account flows
6. ship Copilot account support
7. ship Gemini account support if CLI verification is clean

### Decide later

8. ship Codex account support only if the value justifies the maintenance burden

## Success Criteria

This project is successful when:

- Claude continues to work with no regression
- account UI is provider-aware instead of Claude-specific
- adding a new provider no longer requires editing a central Claude-shaped manager
- at least one additional provider ships on the new architecture
- the codebase is cleaner after the work than before it

## File And Area Checklist

Phase 1 touch points (completed):

- ~~`src/main/account-manager.ts` → split/refactor~~ — deleted, replaced by `src/main/accounts/`
- ~~`src/main/session/session-manager.ts`~~ — updated
- ~~`src/main/accounts/*`~~ — created
- ~~`tests/unit/main/accounts/*`~~ — created

Remaining touch points (Phase 2+):

- `src/shared/types.ts`
- `src/shared/session-agents.ts`
- `src/shared/ipc-contract-app.ts`
- `src/preload/index.ts`
- `src/renderer/stores/accounts-store.ts`
- `src/renderer/components/AccountsDialog.tsx`
- `src/renderer/components/Sidebar/NewSessionDialog.tsx`
- `src/renderer/components/SessionTile/SessionEndedPrompt.tsx`
- `db/migrations/*`
- `tests/unit/renderer/*account*`
- provider-specific account adapter tests

## Final Recommendation

Pursue multi-agent account support, but treat it as an **architecture project with a feature outcome**, not as a small feature patch.

If we do the cleanup first, the result is a cleaner system that:

- preserves Claude behavior
- unlocks Copilot and Gemini support with far less branching debt
- makes future provider additions materially easier

If we skip the cleanup and add provider support directly into the current account manager and UI, the code will become harder to reason about and more expensive to maintain with each new agent.
