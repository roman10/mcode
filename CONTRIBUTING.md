# Contributing to mcode

Thanks for your interest in contributing to mcode! This guide covers everything you need to get started.

## Prerequisites

- **macOS** (primary supported platform)
- **Node.js 22+**
- **Claude Code CLI** installed and authenticated (mcode spawns Claude Code sessions)

## Development Setup

```bash
git clone https://github.com/anthropics/mcode.git
cd mcode
npm install
npm run dev
```

`npm run dev` starts the Electron app with hot-reload via electron-vite.

## Project Structure

```
src/
  main/           Electron main process (session management, PTY, SQLite, IPC)
  renderer/       React frontend (components, stores, hooks, styles)
  preload/        Electron preload scripts (IPC bridge)
  shared/         Types and constants shared between main and renderer
  devtools/       MCP tool definitions for agent automation
db/
  migrations/     Numbered SQL migration files (001_initial.sql, ...)
tests/
  suites/         Vitest test suites
  fixtures/       Test fixtures
```

## Code Conventions

- **One React component per file**, PascalCase filename matching component name
- **Zustand stores** suffixed `-store.ts` (e.g. `layout-store.ts`)
- **Shared types** in `src/shared/types.ts`, constants in `src/shared/constants.ts`
- **Database tables**: plural snake_case (`sessions`, `task_queue`)
- **SQLite migrations**: numbered SQL files in `db/migrations/`
- **Tailwind v4**: use `@theme` directives in `global.css` for design tokens (no JS config)
- **Terminal font**: JetBrains Mono 13px, ligatures disabled
- **UI font**: Inter or system, 13px

## Running Tests

```bash
# Type checking
npm run typecheck

# Integration tests (requires a running dev instance)
npm run dev          # in one terminal
npm run test:mcp     # in another terminal
```

The test suite uses Vitest with an MCP client that communicates with the running app. Tests run sequentially (not in parallel).

## Submitting Changes

1. Fork the repository and create a feature branch from `main`
2. Make your changes, keeping each PR focused on a single feature or fix
3. Run `npm run typecheck` and `npm run test:mcp` before submitting
4. Open a pull request against `main` with a clear description of what and why

### Commit Messages

Write concise commit messages that explain the change. Use a prefix:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `refactor:` code restructuring without behavior change
- `test:` adding or updating tests

## Reporting Issues

Use [GitHub Issues](https://github.com/anthropics/mcode/issues). Please include:

- Steps to reproduce
- Expected vs actual behavior
- macOS version and Node.js version

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
