import { createError } from 'evlog'
import { getCapabilityScopes, GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import type {
  GoogleCapability,
  GoogleClientMode,
  GoogleScope,
} from '#shared/utils/google-scopes'

export const GOOGLE_CONNECTION_CALLBACK_PATH = '/api/v1/google/oauth/callback'

export interface GoogleOAuthClient {
  clientMode: GoogleClientMode
  clientId: string
  clientSecret: string
}

/**
 * What each client mode asks for when it connects. Besidka's client asks
 * for `drive.file` and identity only; Calendar joins later through
 * incremental authorization. The bring-your-own mode has no entry until its
 * child registers a resolver.
 */
export const GOOGLE_CONNECTION_CAPABILITIES: Readonly<
  Record<GoogleClientMode, readonly GoogleCapability[]>
> = {
  besidka: ['identity', 'drive-picked'],
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
  return getCapabilityScopes(GOOGLE_CONNECTION_CAPABILITIES[clientMode])
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
    fix: 'Set NUXT_GOOGLE_CLIENT_ID and NUXT_GOOGLE_CLIENT_SECRET',
  })
}

/**
 * The OAuth client for a mode. Besidka's mode reuses the sign-in client
 * from the private runtime config; the bring-your-own mode answers 404
 * until its child supplies the user's own client. `_userId` is unused on
 * purpose: it is the seam that child needs, so every caller already passes
 * it. Never logs or returns the secret to a browser.
 */
export async function resolveGoogleClient(
  clientMode: GoogleClientMode,
  _userId: number,
): Promise<GoogleOAuthClient> {
  if (clientMode !== 'besidka') {
    throw byoUnavailable()
  }

  const config = useRuntimeConfig()
  const clientId = String(config.googleClientId ?? '')
  const clientSecret = String(config.googleClientSecret ?? '')

  if (!clientId || !clientSecret) {
    throw notConfigured()
  }

  return { clientMode, clientId, clientSecret }
}
