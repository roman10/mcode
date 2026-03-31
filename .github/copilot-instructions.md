# Copilot Instructions for `mcode`

## Build, test, and lint commands

```bash
# Development
npm run dev

# Static checks
npm run typecheck
npm run lint

# Build
npm run build
npm run build:mac
npm run package

# Tests
npm test
npm run test:unit

# MCP / integration suites
# Start the dev app in one terminal first
npm run dev

# Then run the suite tests in another terminal
npm run test:mcp
```

Single-test examples:

```bash
# Single unit test file
npx vitest run --config vitest.unit.config.mts tests/unit/renderer/stores/session-store.test.ts

# Single unit test by name
npx vitest run --config vitest.unit.config.mts tests/unit/renderer/stores/session-store.test.ts -t "selectSession"

# Single MCP / integration test file
npx vitest run --config vitest.config.mts tests/suites/session-lifecycle.test.ts

# Single MCP / integration test by name
npx vitest run --config vitest.config.mts tests/suites/session-lifecycle.test.ts -t "creates a session"
```

## High-level architecture

- `src/main/index.ts` is the composition root for the Electron main process. It wires together the PTY broker client, `SessionManager`, `TaskQueue`, git/file/search services, analytics trackers, hook server, updater, sleep blocker, and IPC registration.
- Terminal/session execution is split from the Electron app itself. PTY lifecycle is managed through the broker layer in `src/main/pty/*`, with the broker entry bundled from `src/broker/entry.ts`, so sessions can survive app restarts.
- Session orchestration lives under `src/main/session/`. `session-manager.ts` is the central coordinator; agent-specific launch/resume behavior is implemented behind runtime adapters in `src/main/session/agent-runtimes/*`. Session status and attention are driven by the state logic in `session-state-machine.ts`.
- Hook-driven monitoring is a core part of the app, not an add-on. `src/main/hooks/hook-server.ts` receives agent hook events, while the bridge/config files in `src/main/hooks/*-hook-config.ts` reconcile external CLI hook setup for Codex, Gemini, and Copilot. These events feed session state, task dispatch readiness, git refreshes, and token/input tracking.
- The renderer is a React app organized around Zustand stores in `src/renderer/stores/*`. `src/renderer/App.tsx` composes the shell, while `src/renderer/hooks/useAppInitialization.ts` hydrates sessions, layout, tasks, accounts, and hook runtime state from the main process on startup.
- Main/renderer communication is intentionally typed. The preload bridge in `src/preload/index.ts` exposes `window.mcode.*`, and channel/type definitions are centralized in `src/shared/ipc-contract*.ts`. Renderer code should go through this bridge rather than importing Electron APIs directly.
- UI layout has two distinct modes: tiling/kanban for agent sessions and a bottom terminal panel for terminal-style workflows. Layout state is persisted through the layout repository/store path rather than being owned by individual components.
- MCP automation is a first-class surface. `src/devtools/mcp-server.ts` starts the app’s MCP server and registers tool groups from `src/devtools/tools/*`. The integration suites in `tests/suites/*` talk to a running dev app through the MCP client in `tests/mcp-client.ts`.
- Repo-level MCP config lives in `.mcp.json`. It points at the local `mcode-devtools` server and includes Playwright MCP for browser/UI automation when a session needs to verify renderer behavior from the outside.

## Key conventions

- Existing docs in `CLAUDE.md`, `GEMINI.md`, and `CONTRIBUTING.md` all reinforce the same pattern: if a feature is added, prefer exposing it through existing automation surfaces or new MCP-accessible capabilities so it can be verified by agents.
- When testing via MCP or app APIs, use a fresh dev instance started with `npm run dev`; do not rely on an already-running packaged app. The app explicitly isolates dev data from packaged data in `src/main/index.ts`.
- React components follow one-component-per-file with PascalCase filenames. Zustand stores use the `*-store.ts` suffix.
- Shared types/constants/contracts belong in `src/shared/`, not duplicated across `main` and `renderer`.
- Database schema conventions matter: SQLite migrations are numbered SQL files in `db/migrations/`, and table names use plural snake_case.
- Tailwind is configured through the Vite plugin and CSS `@theme` usage; this repo does not use a `tailwind.config.*` file.
- If you change agent support, check the full integration path: runtime adapter in `src/main/session/agent-runtimes/*`, session persistence/store code, hook bridge/config, typed APIs, and relevant tests in both `tests/unit` and `tests/suites`.
- Suite tests are intentionally sequential (`vitest.config.mts` disables file parallelism), while unit tests use `vitest.unit.config.mts` and run in parallel. Do not assume the two suites have the same runtime model.
