---
description: "Release a new version of mcode. Usage: /mcode-release 0.3.0"
---

Release mcode version `$ARGUMENTS` by following the phases below in strict order.
If any phase fails, stop immediately — do NOT continue to the next phase. Print the
error and suggest how to fix it.

## Phase 0 — Parse version

Extract the version from `$ARGUMENTS`. If empty, ask me what version to release.
Strip a leading `v` if present. The result must be a bare semver string like `0.3.0`.

## Phase 1 — Pre-flight checks

Run ALL of these checks. If any fail, stop and report which failed.

1. **Semver format** — version must match `^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$`
2. **Version is newer** — must be strictly greater than the `version` field in `package.json`.
   Compare with:
   ```bash
   node -e "
     const c = require('./package.json').version;
     const n = process.argv[1];
     const [cM,cm,cp] = c.split('-')[0].split('.').map(Number);
     const [nM,nm,np] = n.split('-')[0].split('.').map(Number);
     if (nM>cM || (nM===cM && nm>cm) || (nM===cM && nm===cm && np>cp)) process.exit(0);
     else { console.error('New version ' + n + ' is not greater than current ' + c); process.exit(1); }
   " "$VERSION"
   ```
3. **Clean working tree** — `git status --porcelain` must be empty
4. **On main branch** — `git branch --show-current` must output `main`
5. **No existing tag** — `git tag -l "v$VERSION"` must be empty
6. **Remote reachable** — `git fetch origin --dry-run` must succeed

## Phase 2 — Bump version

Edit the `"version"` field in `package.json` to the new version.
Verify with `grep '"version"' package.json`.

## Phase 3 — Update CHANGELOG.md

1. Get today's date as `YYYY-MM-DD`.
2. Get commits since the last tag:
   ```bash
   git log $(git describe --tags --abbrev=0)..HEAD --pretty=format:"%s" --no-merges
   ```
3. Categorize by conventional-commit prefix:
   - `feat:` → **New Features**
   - `fix:` → **Bug Fixes**
   - Skip `chore:`, `docs:`, `test:`, `refactor:`, `ci:`, `build:` prefixes
     (or include a brief **Other Changes** section if there are notable ones)
4. Insert a new section in `CHANGELOG.md` after the header line
   "All notable changes to mcode are documented here." and before the first
   existing `## [` heading. Use this exact format — note the Unicode em-dash (—):
   ```
   ## [X.Y.Z] — YYYY-MM-DD

   ### New Features

   - **Short summary** — expanded description

   ### Bug Fixes

   - Fix description
   ```
5. **STOP and show me the generated changelog section.** Ask if it looks good or
   if I want to edit it. Do NOT proceed until I confirm.

## Phase 4 — Commit and tag

```bash
git add package.json CHANGELOG.md
git commit -m "chore: bump version to $VERSION"
git tag "v$VERSION"
git push origin main
git push origin "v$VERSION"
```

The tag push triggers `.github/workflows/release.yml`.

## Phase 5 — Monitor CI

1. Wait 5 seconds for GitHub Actions to register the run.
2. Find the triggered workflow run:
   ```bash
   gh run list --workflow=release.yml --limit 1 --json databaseId,status,conclusion
   ```
3. Watch it to completion (timeout ~35 min):
   ```bash
   gh run watch <RUN_ID> --exit-status
   ```
4. If CI **fails**:
   - Show failed logs: `gh run view <RUN_ID> --log-failed`
   - Tell me CI failed and suggest: fix the issue, delete the tag
     (`git tag -d v$VERSION && git push origin :refs/tags/v$VERSION`),
     revert the commit, and retry.
   - **STOP — do not continue to Phase 6.**

## Phase 6 — Publish the draft release

electron-builder creates a **draft** release on GitHub. We must publish it.
Never create a separate release manually — that causes the auto-update bug
where `latest-mac.yml` and blockmaps are missing.

1. Find the draft release:
   ```bash
   gh api repos/roman10/mcode/releases \
     --jq '.[] | select(.tag_name=="v$VERSION") | {id, draft, name, assets: [.assets[].name]}'
   ```
2. Verify all 5 required assets exist:
   - `latest-mac.yml`
   - `mcode-$VERSION-arm64.dmg`
   - `mcode-$VERSION-arm64.dmg.blockmap`
   - `mcode-$VERSION-arm64-mac.zip`
   - `mcode-$VERSION-arm64-mac.zip.blockmap`

   If any are missing, **STOP** and report which are missing.

3. Publish using the GitHub API:
   ```bash
   gh api -X PATCH repos/roman10/mcode/releases/<RELEASE_ID> \
     -f draft=false -f make_latest=true \
     --jq '{name, draft, assets: [.assets[].name]}'
   ```

4. Verify:
   ```bash
   gh release view "v$VERSION" --repo roman10/mcode
   ```

## Phase 7 — Post-release verification

1. **Homebrew tap** (skip if version contains a hyphen — CI skips pre-releases):
   ```bash
   gh api repos/roman10/homebrew-tap/contents/Casks/mcode.rb \
     --jq '.content' | base64 -d | grep 'version '
   ```
   If it does not yet show the new version, the update-homebrew job may still
   be running. Wait and retry.

2. Print a summary:
   ```
   Release v$VERSION complete:
   - package.json updated to $VERSION
   - CHANGELOG.md updated
   - Tag v$VERSION pushed
   - CI passed
   - GitHub release published (5 assets)
   - Homebrew tap updated
   - https://github.com/roman10/mcode/releases/tag/v$VERSION
   ```
