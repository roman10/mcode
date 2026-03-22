# Auto-Update Roadmap

## Current: Phase 1 — Manual Version Check (shipped)

Manual version check against GitHub Releases API + StatusBar pill notification.
No code signing required. User downloads manually from GitHub Releases page.

See `src/main/update-checker.ts` for implementation.

---

## Phase 2 — Seamless Auto-Update via electron-updater

**Prerequisites:**
- Apple Developer Program enrollment ($99/yr)
- Code signing configured in electron-builder
- CI/CD pipeline publishing to GitHub Releases

**Implementation:**
1. Add `electron-updater` dependency (already bundled with electron-builder)
2. Add `publish` config to package.json:
   ```json
   "publish": {
     "provider": "github",
     "owner": "roman10",
     "repo": "mcode"
   }
   ```
3. Add `zip` target alongside `dmg` in mac config (required for auto-update on macOS)
4. Replace `UpdateChecker.check()` with `autoUpdater.checkForUpdatesAndNotify()`
5. Keep the same `app:update-available` IPC contract — renderer/preload layer unchanged
6. Add download progress tracking and "Restart to Update" button in StatusBar

**Code signing setup:**
- Generate/obtain Apple Developer ID Application certificate
- Configure `CSC_LINK` and `CSC_KEY_PASSWORD` in CI environment
- Enable notarization in electron-builder config:
  ```json
  "mac": {
    "notarize": true
  }
  ```

**CI/CD (GitHub Actions):**
- Build on macOS runner with Xcode
- Sign and notarize via `electron-builder --publish always`
- Artifacts uploaded to GitHub Releases automatically

---

## Phase 3 — Homebrew Cask Distribution

**Implementation:**
1. Create a Homebrew tap repository (e.g., `roman10/homebrew-tap`)
2. Add cask formula pointing to GitHub Releases DMG URL
3. Auto-update formula on each release (via GitHub Actions)

**Example cask formula:**
```ruby
cask "mcode" do
  version "0.1.0"
  sha256 "<sha256>"

  url "https://github.com/roman10/mcode/releases/download/v#{version}/mcode-#{version}-arm64.dmg"
  name "mcode"
  desc "Desktop IDE for managing multiple autonomous Claude Code sessions"
  homepage "https://github.com/roman10/mcode"

  app "mcode.app"

  zap trash: [
    "~/Library/Application Support/mcode",
    "~/Library/Logs/mcode",
  ]
end
```

Users install with `brew install --cask roman10/tap/mcode` and update with `brew upgrade`.
