/**
 * electron-builder afterSign hook — notarizes the macOS app with Apple.
 *
 * Required env vars (set in CI or your shell before running `npm run build:mac`):
 *   APPLE_ID               — your Apple ID email (liuf0005@gmail.com)
 *   APPLE_APP_SPECIFIC_PASSWORD — app-specific password from appleid.apple.com
 *   APPLE_TEAM_ID          — your 10-char team ID from developer.apple.com/account
 *
 * Skipped automatically when any of those vars are missing (e.g. in CI without secrets).
 */

const { notarize } = require('@electron/notarize')
const path = require('path')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('Notarization skipped: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)

  console.log(`Notarizing ${appPath}...`)

  await notarize({
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  })

  console.log('Notarization complete.')
}
