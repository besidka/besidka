import { createError } from 'evlog'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import type { GoogleClientMode, GoogleScope } from '#shared/utils/google-scopes'

export const GOOGLE_CONNECTION_CALLBACK_PATH = '/api/v1/google/oauth/callback'

export interface GoogleOAuthClient {
  clientMode: GoogleClientMode
  clientId: string
  clientSecret: string
  dedicated: boolean
}

/**
 * What each client mode asks for when it connects. Besidka's client asks
 * for `drive.file`, `openid` and the email scope (the email is shown on the
 * connection card); `userinfo.profile` is not needed. Calendar joins later
 * through incremental authorization. The bring-your-own mode has no entry
 * until its child registers a resolver.
 */
export const GOOGLE_CONNECTION_SCOPES: Readonly<
  Record<GoogleClientMode, readonly GoogleScope[]>
> = {
  besidka: [GOOGLE_SCOPES.openid, GOOGLE_SCOPES.email, GOOGLE_SCOPES.driveFile],
  byo: [],
}

export const GOOGLE_CONNECTION_REQUIRED_SCOPES: Readonly<
  Record<GoogleClientMode, readonly GoogleScope[]>
> = {
  besidka: [GOOGLE_SCOPES.driveFile],
  byo: [],
}

export function getConnectionScopes(
  clientMode: GoogleClientMode,
): GoogleScope[] {
  return [...GOOGLE_CONNECTION_SCOPES[clientMode]]
}

export function buildGoogleRedirectUri(
  origin: string,
  clientMode: GoogleClientMode,
): string {
  if (clientMode !== 'besidka') {
    throw byoUnavailable()
  }

  return `${origin}${GOOGLE_CONNECTION_CALLBACK_PATH}`
}

function byoUnavailable() {
  return createError({
    message: 'Not found',
    status: 404,
    why: 'Connecting with your own Google client is not available yet',
    fix: 'Use the Google Drive connection on the API Keys page',
  })
}

function notConfigured() {
  return createError({
    message: 'Google is not configured',
    status: 503,
    why: 'The Google OAuth client id or secret is missing on this server',
    fix: 'Set NUXT_GOOGLE_DRIVE_CLIENT_ID and NUXT_GOOGLE_DRIVE_CLIENT_SECRET',
  })
}

function readDedicatedClient(): { clientId: string, clientSecret: string } {
  const config = useRuntimeConfig()

  return {
    clientId: String(config.googleDriveClientId ?? ''),
    clientSecret: String(config.googleDriveClientSecret ?? ''),
  }
}

/**
 * Whether Drive connections run on their own OAuth client
 * (`NUXT_GOOGLE_DRIVE_CLIENT_ID` and `_SECRET`) instead of the sign-in
 * client. Required before `google.drive` leaves `internal`: Google revokes
 * per client and user, so on the shared client a disconnect also ends the
 * user's "Sign in with Google" consent.
 */
export function isDedicatedGoogleClientConfigured(): boolean {
  const dedicated = readDedicatedClient()

  return !!dedicated.clientId && !!dedicated.clientSecret
}

/**
 * The OAuth client for a mode: the dedicated Drive client when it is
 * configured, otherwise the sign-in client from the private runtime
 * config. The bring-your-own mode answers 404 until its child supplies the
 * user's own client. Never logs or returns the secret to a browser.
 */
export async function resolveGoogleClient(
  clientMode: GoogleClientMode,
): Promise<GoogleOAuthClient> {
  if (clientMode !== 'besidka') {
    throw byoUnavailable()
  }

  if (isDedicatedGoogleClientConfigured()) {
    return { clientMode, ...readDedicatedClient(), dedicated: true }
  }

  const config = useRuntimeConfig()
  const clientId = String(config.googleClientId ?? '')
  const clientSecret = String(config.googleClientSecret ?? '')

  if (!clientId || !clientSecret) {
    throw notConfigured()
  }

  return { clientMode, clientId, clientSecret, dedicated: false }
}
