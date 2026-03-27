/**
 * electron-builder afterSign hook — notarizes the macOS app with Apple.
 *
 * Uses `xcrun notarytool` directly with a keychain profile for reliability.
 * Set up the profile once:
 *   xcrun notarytool store-credentials "mcode-profile" \
 *     --apple-id <email> --team-id <team> --password <app-specific-password>
 *
 * Falls back to env-var auth (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID)
 * via @electron/notarize if the keychain profile doesn't exist.
 */

const { execFileSync } = require('child_process')
const path = require('path')

function keychainProfileExists(profile) {
  try {
    // A quick info call on a dummy ID will fail, but with exit code 69 (no such submission)
    // if credentials are valid. If the profile doesn't exist, it fails differently.
    execFileSync('xcrun', ['notarytool', 'history', '--keychain-profile', profile], {
      stdio: 'pipe',
      timeout: 15_000,
    })
    return true
  } catch (e) {
    // exit code 69 = valid credentials but no submissions, still means profile works
    // exit code 1 with "credentials" in message = profile not found
    if (e.status === 69) return true
    return false
  }
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)

  const PROFILE = 'mcode-profile'

  // Prefer keychain profile (faster, no secrets on CLI)
  if (keychainProfileExists(PROFILE)) {
    console.log(`Notarizing ${appPath} via keychain profile "${PROFILE}"...`)

    // Zip the .app for notarytool
    const zipPath = path.join(appOutDir, `${appName}.zip`)
    execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath], { stdio: 'inherit' })

    try {
      // 30-minute timeout to handle slow Apple service
      const result = execFileSync('xcrun', [
        'notarytool', 'submit', zipPath,
        '--keychain-profile', PROFILE,
        '--wait',
        '--timeout', '30m',
      ], { stdio: 'pipe', timeout: 35 * 60 * 1000, encoding: 'utf-8' })

      console.log(result)

      if (!result.includes('status: Accepted')) {
        // Fetch the log for diagnostics
        const idMatch = result.match(/id:\s*([0-9a-f-]+)/)
        if (idMatch) {
          try {
            const log = execFileSync('xcrun', [
              'notarytool', 'log', idMatch[1], '--keychain-profile', PROFILE,
            ], { stdio: 'pipe', timeout: 30_000, encoding: 'utf-8' })
            console.error('Notarization log:', log)
          } catch (_) { /* ignore log fetch failure */ }
        }
        throw new Error(`Notarization failed:\n${result}`)
      }
    } finally {
      // Clean up temp zip
      try { require('fs').unlinkSync(zipPath) } catch (_) {}
    }

    // Staple the ticket to the app
    execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' })
    console.log('Notarization + stapling complete.')
    return
  }

  // Fallback: env-var auth via @electron/notarize
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('Notarization skipped: no keychain profile and APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set')
    return
  }

  console.log(`Notarizing ${appPath} via @electron/notarize...`)
  const { notarize } = require('@electron/notarize')
  await notarize({
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  })
  console.log('Notarization complete.')
}
