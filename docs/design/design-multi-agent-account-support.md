# Multi-Agent Account Support — Detailed Design Plan

## Overview

`mcode` already has the beginnings of a generic account system:

- sessions persist `accountId`
- account profiles are stored independently from sessions
- agent metadata already has `supportsAccountProfiles`

Through Phases 0–3, the system has been evolved from a Claude-only implementation into a **provider-aware, capability-driven account architecture**:

- `AccountManager` was deleted and replaced by focused modules under `src/main/accounts/` (Phase 1)
- Provider adapter registry routes auth, config isolation, and session env through per-provider implementations (Phase 1)
- Provider-scoped identity persistence via `account_provider_identities` table (Phase 2+3)
- IPC channels are parameterized by `sessionType` (Phase 2+3)
- Renderer account selector is gated by `supportsAccountProfiles` capability, not Claude-specific checks (Phase 2+3)
- Auth terminal launch and CLI status banners are adapter-driven (Phase 2+3)

Adding a new provider adapter now requires **zero IPC or renderer changes** — only implementing the `AccountProviderAdapter` interface and setting `supportsAccountProfiles: true` in agent metadata.

This document records the full design rationale and phased delivery plan.

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

> **Note:** `account-manager.ts` was deleted in Phase 1. Renderer issues below were resolved in Phase 2+3.

- ~~`src/main/account-manager.ts`~~ — deleted in Phase 1, replaced by `src/main/accounts/`
- ~~`src/renderer/components/Sidebar/NewSessionDialog.tsx`~~ — account selector now gated by `supportsAccountProfiles` (Phase 2+3)
- ~~`src/renderer/components/AccountsDialog.tsx`~~ — CLI strings now driven by agent metadata (Phase 2+3); per-provider verification rows deferred to Phase 5
- ~~`src/renderer/components/Sidebar/SidebarPanel.tsx`~~ — CLI status banners now driven by agent metadata (Phase 2+3)

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

### Problem A — `AccountProfile` stores Claude-shaped identity (RESOLVED)

> **Resolved in Phase 2+3.** Provider-specific identity now lives in `account_provider_identities` table. `account_profiles.email` is retained as transitional legacy state with dual-write from `AccountService`.

~~Today `AccountProfile` includes `email`, which is treated as the verified identity for the account. That is workable for Claude-only support, but it becomes wrong once an account may have different authenticated identities per provider.~~

**Plan** (delivered)

- ~~keep `account_profiles` as the top-level account container~~ — done
- ~~move provider-specific identity/auth data into a new table~~ — done (`account_provider_identities`, migration 041)
- ~~treat `account_profiles.email` as transitional legacy state only during migration~~ — done (dual-write in `AccountService`)

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

### Problem C — UI behavior is type-checked instead of capability-driven (PARTIALLY RESOLVED)

> **Partially resolved in Phase 2+3.** NewSessionDialog account selector is now gated by `supportsAccountProfiles`. SidebarPanel and AccountsDialog use agent metadata for CLI strings. AccountsDialog per-provider verification rows remain deferred to Phase 5.

**Plan** (mostly delivered)

- ~~move account-related UI decisions behind shared capability helpers~~ — done (NewSessionDialog, SidebarPanel)
- ~~stop using `Claude` as the implicit proxy for `supports accounts`~~ — done
- AccountsDialog per-provider verification rows — deferred to Phase 5

### Problem D — provider-specific operational logic is not isolated (RESOLVED)

> **Resolved in Phase 1 + Phase 2+3.** Provider adapter registry is in place. Auth, config, install help, and session env all route through adapters. IPC channels accept `sessionType` and delegate to the registry.

**Plan** (delivered)

- ~~introduce a provider account adapter/registry~~ — done (Phase 1)
- ~~make the rest of the system depend on that registry~~ — done (Phase 2+3: IPC, auth terminal, CLI check all adapter-driven)

## Architecture

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

- `AccountProfileRepository` — CRUD for `account_profiles` ✓
- `AccountHomeManager` — create/sync/delete isolated homes, generic symlink policy ✓
- `AccountIdentityRepository` — provider-specific auth/identity state ✓ (Phase 2+3)
- `AccountService` — orchestration layer used by IPC and session manager ✓
- `AccountProviderRegistry` — maps agent type to provider adapter ✓

All modules are implemented and tested. This decomposition makes future providers much easier to add and test independently.

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

## Shared-Type Changes

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

### Align `AuthStatusResult` for multi-provider use (DELIVERED)

Delivered in Phase 2+3. `AuthStatusResult` was extended (not renamed) to preserve backward compatibility:

```ts
interface AuthStatusResult {
  status: CliAuthStatus;
  email?: string;         // kept — renderer reads this for Claude
  identity?: string;      // provider-neutral: email, username, auth mode
  displayName?: string;   // optional human-friendly label
}
```

The `email` field is retained for backward compatibility. `identity` is the provider-neutral equivalent. Claude adapter sets both `email` and `identity` to the same value.

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

## IPC And API Changes

### Profile-level calls (unchanged)

- `account:list`
- `account:create`
- `account:rename`
- `account:delete`

### Provider-aware calls (delivered in Phase 2+3)

Rather than renaming channels, the existing channels gained an optional `sessionType?` parameter defaulting to `'claude'`. This preserves backward compatibility — all existing callers work unchanged.

- `account:get-auth-status(accountId, sessionType?)` — routes through provider adapter
- `account:open-auth-terminal(accountId, sessionType?)` — uses `adapter.buildAuthTerminalInput()`
- `account:check-cli-installed(sessionType?)` — uses `adapter.checkCliInstalled()`

Subscription usage remains Claude-specific for now (`account:get-subscription-usage(accountId, force)`).

### Deferred calls

- `account:list-provider-identities(accountId?)` — not needed until Phase 5 (renderer reads identity table directly when a second provider ships)

## Refactoring And Cleanup Plan

These refactors should be treated as part of the project, not optional polish.

### R1 — Move agent-specific account capabilities into shared metadata

Extend `AgentDefinition` or add a nearby capability helper so renderer and main process can ask:

- does this provider support account profiles
- does this provider support provider-specific auth verification
- does this provider expose usage/quota data
- what install URL should be shown

This avoids duplicating provider checks in UI components.

### R2 — Replace `isClaude` account gating in `NewSessionDialog` (COMPLETED)

> **Delivered in Phase 2+3.** Account selector extracted from `{isClaude && ...}` block and gated by `supportsAccountProfiles` capability flag.

- ~~use `supportsAccountProfiles`~~ — done
- ~~show account selection for any eligible provider~~ — done (zero visual change now, automatic support when a provider sets `supportsAccountProfiles: true`)
- ~~keep Claude-only fields such as effort/worktree separate from account support~~ — done

### R3 — Split `AccountManager` (COMPLETED)

Delivered in Phase 1. Final shape:

- `src/main/accounts/account-profile-repository.ts` — DB CRUD
- `src/main/accounts/account-home-manager.ts` — filesystem isolation
- `src/main/accounts/account-service.ts` — orchestration layer
- `src/main/accounts/account-ipc.ts` — IPC handlers
- `src/main/accounts/account-provider.ts` — adapter interface + registry
- `src/main/accounts/providers/claude-account-provider.ts` — Claude adapter
- `src/main/accounts/index.ts` — barrel exports
- `account-identity-repository.ts` — delivered in Phase 2+3

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

### R6 — Remove provider-shaped data from generic UI store state (PARTIALLY RESOLVED)

> **Partially resolved in Phase 2+3.** IPC is parameterized by `sessionType`. Identity table is provider-scoped. Renderer store still reads legacy `account_profiles.email` — will switch to identity table in Phase 5.

Remaining:

- make account store provider-aware (cache keyed by `(accountId, sessionType)`) — defer to Phase 5

### R7 — Unify provider help and auth-launch behavior (COMPLETED)

> **Delivered in Phase 2+3.** Auth terminal launch is adapter-driven via `buildAuthTerminalInput()`. SidebarPanel and AccountsDialog use `getAgentDefinition()` for CLI display names and install help URLs instead of hardcoded strings.

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

## Phase 2 — Data Model Migration (COMPLETED — combined with Phase 3)

### Goals

- support provider-specific identity and usage state
- keep existing user data intact

### Work

- ~~add `account_provider_identities`~~ — done (migration 041)
- ~~defer `account_provider_usage_cache`~~ — deferred as planned (in-memory TTL cache is sufficient)
- ~~migrate current Claude email state from `account_profiles.email` into provider-scoped identity rows~~ — done (backfill in migration 041)
- ~~keep `account_profiles.email` as a fallback during transition~~ — done (dual-write in `AccountService`)
- ~~add indexes for `(account_id, session_type)`~~ — composite PK covers this

### Deliverables

- ~~provider-scoped identity model~~ — done
- ~~migration and backfill logic~~ — done

## Phase 3 — Renderer And IPC Modernization (PARTIALLY COMPLETED — combined with Phase 2)

### Goals

- make account UX capability-driven and provider-aware

### Work

- ~~update preload and IPC contracts with provider-aware methods~~ — done (`sessionType?` on 3 channels)
- update `accounts-store.ts` to cache provider-specific identity state — deferred to Phase 5
- update `AccountsDialog.tsx` to show provider-aware verification rows — deferred to Phase 5
- ~~update `NewSessionDialog.tsx` to show account selection for all supported providers~~ — done
- update ended-session resume prompts to stay capability-driven — deferred to Phase 5

### UX direction (planned for Phase 5)

**AccountsDialog layout:**

- top-level account profile list remains the same (default account, then secondary accounts)
- each account row shows the account name and a summary line (e.g., "Claude: ok · Copilot: not verified")
- clicking an account expands it to show per-provider status rows:
  - one row per provider where `supportsAccountProfiles === true`
  - each row shows: provider icon + name, auth status badge (green/amber/red), identity text (email/username), and a Verify/Login action button
  - providers where CLI is not installed show an Install link instead of Verify
- verify/login actions are scoped to the clicked provider row
- the "Add Account" flow remains the same (creates profile, then user can verify per provider)

**NewSessionDialog (delivered):**

- ~~account selector dropdown appears for any agent where `supportsAccountProfiles === true` and `accounts.length > 1`~~ — done
- each option shows: account name + provider-specific identity (e.g., "Work — waterdrop86" for Copilot, "Work — user@example.com" for Claude) — identity display deferred to Phase 5
- if the selected account has no verified identity for the chosen provider, show a subtle warning but allow session creation — deferred to Phase 5

### Deliverables

- ~~provider-aware IPC contract in place~~ — done
- ~~renderer account selector is capability-driven~~ — done
- AccountsDialog per-provider verification rows — deferred to Phase 5

## Phase 4 — Claude Migration Hardening

### Goals

- ensure Claude behavior remains stable after the refactor
- remove compatibility debt introduced in earlier phases

### Work

**Step 1 — Shared types (`src/shared/types.ts`)**
- Remove `email: string | null` from `AccountProfile`
- Add `AccountProviderIdentity` interface (shared version of `ProviderIdentityRow`, needed in renderer):
  ```ts
  interface AccountProviderIdentity {
    accountId: string;
    sessionType: string;
    authStatus: CliAuthStatus;
    identity: string | null;
    displayName: string | null;
    lastCheckedAt: string | null;
    lastAuthenticatedAt: string | null;
  }
  ```
- Add `AccountProfileWithProviders`:
  ```ts
  interface AccountProfileWithProviders extends AccountProfile {
    providers: Partial<Record<string, AccountProviderIdentity>>;
  }
  ```

**Step 2 — `AccountIdentityRepository`**
- Add `listAll(): ProviderIdentityRow[]` (unfiltered, for the list-with-providers join)

**Step 3 — `AccountService`**
- Add `listWithProviders(): AccountProfileWithProviders[]`:
  - calls `this.repo.list()` + `this.identityRepo.listAll()`
  - groups identity rows by `account_id` and merges into a `providers` map per account

**Step 4 — IPC layer**
- `account-ipc.ts`: change `account:list` handler to call `listWithProviders()`
- `ipc-contract-app.ts`: update `account:list` return type to `AccountProfileWithProviders[]`
- `src/preload/index.ts`: update `list()` return type

**Step 5 — `accounts-store.ts`**
- Type `accounts` as `AccountProfileWithProviders[]` (no logic change — store just carries richer data)

**Step 6 — Renderer components (5 files)**

| File | Old | New |
|------|-----|-----|
| `AccountsDialog.tsx:31` | `Boolean(account.email)` | `account.providers?.claude?.authStatus === 'ok'` |
| `AccountsDialog.tsx:37` | `account.email ?? '...'` | `account.providers?.claude?.identity ?? '...'` |
| `AccountsDialog.tsx:141` | `result.email` → suggestName | `result.identity` → suggestName |
| `AccountsDialog.tsx:243` | `!defaultAccount.email` | `!defaultAccount.providers?.claude` |
| `NewSessionDialog.tsx:276` | `account.email` | `account.providers?.claude?.identity` |
| `SessionEndedPrompt.tsx:103` | `a.email` | `a.providers?.claude?.identity` |
| `TerminalToolbar.tsx:138` | `email={account.email}` | `email={account.providers?.claude?.identity ?? null}` |
| `CostSection.tsx:277,286,288,299,305` | `a.email` | `a.providers?.claude?.identity` |

**Step 7 — Tests**
- Add `AccountIdentityRepository.listAll()` test
- Add `AccountService.listWithProviders()` unit test
- Update test fixtures that include `email` on `AccountProfile` objects (3 files: `account-home-manager.test.ts`, `account-profile-repository.test.ts`, `account-service.test.ts`)
- Remove or update the `setEmail` tests — `service.setEmail()` becomes internal; `repo.setEmail()` stays for DB backward compat

**Known pre-Phase 5 limitation (deferred, fix in Phase 5)**
- `account-home-manager.ts:55-58`: `.claude/settings.json` copy during `setupAccountDirectory()` is hardcoded to Claude. Should be provider-driven so Copilot/Gemini settings are copied too.
- `getAllSettingsPaths()` hardcodes `.claude/settings.json`. Should use the provider registry.

### Deliverables

- `AccountProfile` no longer carries `email` — renderer reads provider identity from `providers` map
- `account:list` IPC returns `AccountProfileWithProviders[]`
- All renderer components use provider-neutral identity display
- `account_profiles.email` DB column retained for backward compat (dual-write continues) but no longer read by renderer
- ~~`syncSymlinks()` early-return path covered by test~~ — done (added in pre-Phase 4 audit)

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
3. ~~add provider-scoped identity persistence~~ — done (Phase 2+3)
4. ~~migrate Claude to the new foundation~~ — done (Phase 2+3, hardening in Phase 4)

### Then do

5. ~~modernize IPC and renderer account flows~~ — done (Phase 2+3; AccountsDialog per-provider rows in Phase 5)
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

Phase 2+3 touch points (completed):

- ~~`src/shared/types.ts`~~ — `AuthStatusResult` extended with `identity`, `displayName`; `sessionType?` on 3 API methods
- ~~`src/shared/ipc-contract-app.ts`~~ — `sessionType?` on 3 IPC channels
- ~~`src/preload/index.ts`~~ — pass `sessionType?` through preload bridge
- ~~`src/renderer/components/AccountsDialog.tsx`~~ — agent metadata for CLI strings
- ~~`src/renderer/components/Sidebar/NewSessionDialog.tsx`~~ — `supportsAccountProfiles` gating
- ~~`src/renderer/components/Sidebar/SidebarPanel.tsx`~~ — agent metadata for CLI strings
- ~~`src/main/accounts/account-identity-repository.ts`~~ — new, provider-scoped identity CRUD
- ~~`src/main/accounts/account-service.ts`~~ — provider-parameterized auth, dual-write
- ~~`src/main/accounts/account-ipc.ts`~~ — adapter-driven auth terminal
- ~~`src/main/accounts/providers/claude-account-provider.ts`~~ — `identity` in auth result
- ~~`src/main/index.ts`~~ — wire identity repo + registry
- ~~`db/migrations/041_account_provider_identities.sql`~~ — identity table + backfill
- ~~`tests/unit/main/accounts/account-identity-repository.test.ts`~~ — 12 tests
- ~~`tests/unit/main/accounts/account-service.test.ts`~~ — extended with provider tests

Remaining touch points (Phase 4+):

- `src/shared/session-agents.ts` — flip `supportsAccountProfiles` for Copilot/Gemini (Phase 5/6)
- `src/renderer/stores/accounts-store.ts` — provider-aware identity caching (Phase 5)
- `src/renderer/components/AccountsDialog.tsx` — per-provider verification rows (Phase 5)
- `src/renderer/components/SessionTile/SessionEndedPrompt.tsx` — capability-driven resume (Phase 5)
- `tests/unit/renderer/*account*` — renderer account tests (Phase 5)
- provider-specific account adapter tests for Copilot/Gemini/Codex (Phase 5/6/7)

## Final Recommendation

Pursue multi-agent account support, but treat it as an **architecture project with a feature outcome**, not as a small feature patch.

If we do the cleanup first, the result is a cleaner system that:

- preserves Claude behavior
- unlocks Copilot and Gemini support with far less branching debt
- makes future provider additions materially easier

If we skip the cleanup and add provider support directly into the current account manager and UI, the code will become harder to reason about and more expensive to maintain with each new agent.

---

## Status Update — 2026-04-01

### What's done

| Phase | Status | Date |
|-------|--------|------|
| Phase 0 — Discovery & Contract Definition | **COMPLETED** | 2026-03-19 |
| Phase 1 — Foundation Refactor | **COMPLETED** | 2026-04-01 |
| Phase 2+3 — Data Model + IPC/Renderer Modernization | **COMPLETED** | 2026-04-01 |
| Phase 4 — Claude Migration Hardening | Not started | — |
| Phase 5 — Copilot Account Support | Not started | — |
| Phase 6 — Gemini Account Support | Not started | — |
| Phase 7 — Codex Decision Gate | Not started | — |

### Phase 1 recap

Delivered in commit `74aacd5`. The old monolithic `account-manager.ts` (413 lines) was deleted and replaced by a clean module structure:

- `AccountProviderAdapter` interface + `AccountProviderRegistry`
- `AccountProfileRepository` (DB CRUD)
- `AccountHomeManager` (filesystem isolation, provider-driven denylist)
- `AccountService` (orchestration)
- `account-ipc.ts` (IPC handlers, unchanged channel names)
- `claudeAccountProvider` (Claude adapter)
- 49 new tests, 934 total passing

Claude works identically to before. No renderer behavior change. Provider abstraction is in place but only Claude is registered.

### Remaining known limitations

1. `.claude/settings.json` copy in `setupAccountDirectory` is Claude-specific — generalize in Phase 5+
2. `getAllSettingsPaths` only handles Claude settings paths
3. `AccountsDialog` still treats all accounts as Claude accounts (per-provider verification rows deferred to Phase 5)
4. Renderer reads `account_profiles.email` — switch to identity table in Phase 5 when a second provider ships

### Phase 2+3 recap

Delivered as a combined phase. Key changes:

- **Migration 041:** `account_provider_identities` table with Claude email backfill
- **AccountIdentityRepository:** provider-scoped identity CRUD
- **IPC/preload/types:** `sessionType?` parameter on `getAuthStatus`, `checkCliInstalled`, `openAuthTerminal`
- **AccountService:** provider-parameterized auth, dual-write to identity table + legacy email
- **account-ipc.ts:** adapter-driven auth terminal (removes hardcoded `'claude auth login'`), subscription routed through adapter
- **NewSessionDialog:** account selector gated by `supportsAccountProfiles` instead of `isClaude`
- **AccountsDialog + SidebarPanel:** agent metadata for CLI strings instead of hardcoded "Claude Code"
- 17 new tests (960 total)

### Next steps

1. **Phase 4 (Claude hardening)** — lightweight cleanup: remove compatibility shims, tighten tests
2. **Phase 5 (Copilot account support)** — implement adapter, flip `supportsAccountProfiles: true`, wire hook reconciliation. Renderer already supports any `supportsAccountProfiles` agent.
3. **Phase 6 (Gemini)** / **Phase 7 (Codex decision gate)** — as per original plan
