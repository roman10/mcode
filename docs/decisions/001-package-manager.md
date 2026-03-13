# ADR-001: Use npm as package manager

**Status:** Accepted
**Date:** 2026-03-13

## Context

mcode is an Electron app with native Node modules (`node-pty`, `better-sqlite3`) that require `node-gyp` compilation and `electron-rebuild`. We evaluated whether switching from npm to a faster alternative was worthwhile.

## Decision

**Stay with npm.** It has the best compatibility with our native module toolchain.

## Alternatives considered (ranked)

| Manager | Verdict | Why |
|---------|---------|-----|
| **npm** | **Use this** | Zero-config compatibility with `electron-rebuild`, `electron-builder`, and `node-gyp`. All Electron tooling is tested against npm first. |
| **pnpm** | Viable alternative | Works, but requires `node-linker=hoisted` in `.npmrc` — which negates its main structural advantage (strict symlinked `node_modules`). |
| **yarn v4** | Not worth it | PnP mode is incompatible with Electron (WASM 4KB limit, no zip-based native modules). Requires `nodeLinker: node-modules`, making it npm-like with extra config. |
| **bun** | Not recommended | Native addon compatibility is ~34% for node-gyp packages (as of early 2026). `electron-rebuild` and `electron-builder` are not reliably supported. |

## Key factors

- **Native modules are the bottleneck.** `node-pty` and `better-sqlite3` both use `node-gyp`. Any package manager must support the full `electron-rebuild` pipeline without workarounds.
- **Speed is a non-factor.** With ~15 dependencies, install time differences are negligible.
- **Revisit if:** the dependency tree grows significantly, or bun's native addon support matures past 90%.
