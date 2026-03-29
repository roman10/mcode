# Auto-Update Roadmap

## Phase 1 — Manual Version Check (retired)

Manual version check against GitHub Releases API + StatusBar pill notification.
Replaced by Phase 2. Old `src/main/update-checker.ts` has been removed.

---

## Current: Phase 2 — Seamless Auto-Update via electron-updater (shipped)

Full auto-update pipeline using `electron-updater` with GitHub as the update provider.

**What's in place:**
- `electron-updater` v6.8.3 with `autoDownload = false` (user-initiated download)
- Periodic checks: 10s after launch, then every 4 hours
- GitHub publish config in package.json (`provider: github`, `owner: roman10`, `repo: mcode`)
- macOS targets: `dmg` + `zip` (zip required for auto-update)
- Code signing: Developer ID Application + hardened runtime
- Notarization: `@electron/notarize` via `scripts/notarize.js` afterSign hook
- CI/CD: `.github/workflows/release.yml` — triggered on `v*` tags, builds + publishes signed artifacts
- StatusBar UI pill with states: available → downloading (with %) → restart to update → error fallback
- Type-safe IPC contract for all update events
- Unit tests in `tests/unit/main/auto-updater.test.ts`

**Key files:**
- `src/main/auto-updater.ts` — core AutoUpdater class
- `src/renderer/components/BottomPanel/StatusBar.tsx` — update UI
- `src/shared/ipc-contract.ts` — IPC type definitions
- `scripts/notarize.js` — Apple notarization hook
- `.github/workflows/release.yml` — release pipeline

---

## Phase 3 — Homebrew Cask Distribution (shipped)

Homebrew tap at [`roman10/homebrew-tap`](https://github.com/roman10/homebrew-tap) with auto-updating cask formula.

**What's in place:**
- Public tap repo with `Casks/mcode.rb` formula (arm64, macOS Ventura+)
- `update-homebrew` job in `.github/workflows/release.yml` — runs after `build-mac`, downloads DMG, computes SHA256, pushes updated formula to tap repo
- Skips pre-release tags (e.g., `v0.3.0-rc1`)
- Requires `HOMEBREW_TAP_TOKEN` secret in `roman10/mcode` repo

**Install:** `brew install --cask roman10/tap/mcode`
**Upgrade:** `brew upgrade --cask mcode`
