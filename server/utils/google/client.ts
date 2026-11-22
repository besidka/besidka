import { createError } from 'evlog'
import { GOOGLE_BYO_CALLBACK_PATH } from '#shared/utils/google-byo'
import {
  GOOGLE_SCOPES,
  isCapabilityAllowedForClient,
  GOOGLE_CAPABILITIES,
  GOOGLE_SCOPE_CAPABILITIES,
} from '#shared/utils/google-scopes'
import type { GoogleClientMode, GoogleScope } from '#shared/utils/google-scopes'
import type { FeatureKv } from '~~/server/utils/features/evaluate'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { assertGoogleByoAllowed } from '~~/server/utils/google/byo-access'
import { readGoogleByoClient } from '~~/server/utils/google/byo-client'

export const GOOGLE_CONNECTION_CALLBACK_PATH = '/api/v1/google/oauth/callback'

export interface GoogleOAuthClient {
  clientMode: GoogleClientMode
  clientId: string
  clientSecret: string
  dedicated: boolean
}

export interface GoogleClientContext {
  db: ReturnType<typeof useDb>
  userId: number
  kv?: FeatureKv
  logger?: LoggerLike
}

/**
 * What each client mode always asks for when it connects. Besidka's client
 * asks for `drive.file`, `openid` and the email scope (the email is shown
 * on the connection card); `userinfo.profile` is not needed. Calendar joins
 * later through incremental authorization. The bring-your-own client asks
 * for `openid` and the email scope plus the capabilities the owner ticks at
 * connect time (`getConnectionScopes`).
 */
export const GOOGLE_CONNECTION_SCOPES: Readonly<
  Record<GoogleClientMode, readonly GoogleScope[]>
> = {
  besidka: [GOOGLE_SCOPES.openid, GOOGLE_SCOPES.email, GOOGLE_SCOPES.driveFile],
  byo: [GOOGLE_SCOPES.openid, GOOGLE_SCOPES.email],
}

/**
 * The scopes a grant must hold to be saved at all. The bring-your-own
 * client has no fixed entry: its required set is what the owner asked for
 * (`requiredConnectionScopes`).
 */
export const GOOGLE_CONNECTION_REQUIRED_SCOPES: Readonly<
  Record<GoogleClientMode, readonly GoogleScope[]>
> = {
  besidka: [GOOGLE_SCOPES.driveFile],
  byo: [],
}

const BYO_CAPABILITY_SCOPES: ReadonlySet<string> = new Set(
  GOOGLE_CAPABILITIES.flatMap((capability) => {
    if (
      capability === 'identity'
      || !isCapabilityAllowedForClient(capability, 'byo')
    ) {
      return []
    }

    return GOOGLE_SCOPE_CAPABILITIES[capability].scopes
  }),
)

/**
 * Keeps only scopes a capability of the bring-your-own client grants, so
 * a stored state or a caller can never widen a request beyond the scope
 * map in `shared/utils/google-scopes.ts`.
 */
export function filterByoCapabilityScopes(
  scopes: readonly string[],
): GoogleScope[] {
  return [...new Set(scopes)].filter((scope): scope is GoogleScope => {
    return BYO_CAPABILITY_SCOPES.has(scope)
  })
}

export function getConnectionScopes(
  clientMode: GoogleClientMode,
  capabilityScopes: readonly string[] = [],
): GoogleScope[] {
  if (clientMode === 'besidka') {
    return [...GOOGLE_CONNECTION_SCOPES.besidka]
  }

  return [
    ...GOOGLE_CONNECTION_SCOPES.byo,
    ...filterByoCapabilityScopes(capabilityScopes),
  ]
}

export function requiredConnectionScopes(
  clientMode: GoogleClientMode,
  capabilityScopes: readonly string[] = [],
): GoogleScope[] {
  if (clientMode === 'besidka') {
    return [...GOOGLE_CONNECTION_REQUIRED_SCOPES.besidka]
  }

  return filterByoCapabilityScopes(capabilityScopes)
}

export function getGoogleCallbackPath(clientMode: GoogleClientMode): string {
  return clientMode === 'byo'
    ? GOOGLE_BYO_CALLBACK_PATH
    : GOOGLE_CONNECTION_CALLBACK_PATH
}

export function buildGoogleRedirectUri(
  origin: string,
  clientMode: GoogleClientMode,
): string {
  return `${origin}${getGoogleCallbackPath(clientMode)}`
}

function notConfigured() {
  return createError({
    message: 'Google is not configured',
    status: 503,
    why: 'The Google OAuth client id or secret is missing on this server',
    fix: 'Set NUXT_GOOGLE_DRIVE_CLIENT_ID and NUXT_GOOGLE_DRIVE_CLIENT_SECRET',
  })
}

function byoClientMissing() {
  return createError({
    message: 'Your Google OAuth client is not saved',
    status: 409,
    why: 'No client id and secret of your own Google OAuth client are stored',
    fix: 'Save your client id and secret on the Google tab of API Keys',
  })
}

function byoContextMissing() {
  return createError({
    message: 'Not found',
    status: 404,
    why: 'The bring-your-own Google client needs the user it belongs to',
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

async function resolveByoClient(
  context: GoogleClientContext | undefined,
): Promise<GoogleOAuthClient> {
  if (!context) {
    throw byoContextMissing()
  }

  await assertGoogleByoAllowed(context)

  const stored = await readGoogleByoClient(context.db, context.userId)

  if (!stored) {
    throw byoClientMissing()
  }

  return { clientMode: 'byo', ...stored, dedicated: true }
}

/**
 * The OAuth client for a mode. Besidka's mode uses the dedicated Drive
 * client when it is configured, otherwise the sign-in client from the
 * private runtime config. The bring-your-own mode first passes the admin
 * and `google.byo` gate (`assertGoogleByoAllowed`) for the user in
 * `context`, then reads the owner's stored client; it never falls back to
 * Besidka's client. Never logs or returns the secret to a browser.
 */
export async function resolveGoogleClient(
  clientMode: GoogleClientMode,
  context?: GoogleClientContext,
): Promise<GoogleOAuthClient> {
  if (clientMode === 'byo') {
    return await resolveByoClient(context)
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
