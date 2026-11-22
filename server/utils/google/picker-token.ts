import type { KVNamespace } from '@cloudflare/workers-types'
import { createError } from 'evlog'
import {
  GOOGLE_SCOPES,
  parseGoogleScopes,
} from '#shared/utils/google-scopes'
import type { GoogleClientMode } from '#shared/utils/google-scopes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  getGoogleAccessToken,
  readGoogleConnectionTokenState,
} from '~~/server/utils/google/tokens'

type DbClient = ReturnType<typeof useDb>

export const GOOGLE_PICKER_NOT_CONNECTED_CODE = 'google_not_connected'
export const GOOGLE_PICKER_REAUTHORIZE_CODE = 'google_reauthorize'
export const GOOGLE_PICKER_NOT_CONFIGURED_CODE = 'google_picker_not_configured'
export const GOOGLE_PICKER_CLIENT_REFUSED_CODE = 'google_picker_client_refused'
export const GOOGLE_PICKER_SCOPE_TOO_WIDE_CODE = 'google_picker_scope_too_wide'

/**
 * The only scopes a token handed to the browser may carry: identity and
 * `drive.file`. A grant with anything else (Calendar, or any restricted
 * scope) is never handed out, because an access token cannot be narrowed.
 */
const PICKER_TOKEN_SCOPES: ReadonlySet<string> = new Set([
  GOOGLE_SCOPES.openid,
  GOOGLE_SCOPES.email,
  GOOGLE_SCOPES.profile,
  GOOGLE_SCOPES.driveFile,
])

export interface GooglePickerTokenInput {
  db: DbClient
  kv: KVNamespace
  userId: number
  clientMode: GoogleClientMode
  apiKey: string
  projectNumber: string
  logger?: LoggerLike
  now?: () => number
}

export interface GooglePickerTokenResult {
  accessToken: string
  expiresInSeconds: number
  apiKey: string
  appId: string
}

function notConnected() {
  return createError({
    message: 'Google Drive is not connected',
    status: 404,
    code: GOOGLE_PICKER_NOT_CONNECTED_CODE,
    why: 'There is no Google Drive connection for this account',
    fix: 'Connect Google Drive on the API Keys page',
    link: '/profile/keys?tab=google',
  })
}

function reauthorize(why: string) {
  return createError({
    message: 'Reconnect Google Drive',
    status: 409,
    code: GOOGLE_PICKER_REAUTHORIZE_CODE,
    why,
    fix: 'Reconnect Google Drive on the API Keys page',
    link: '/profile/keys?tab=google',
  })
}

function isGrantTooWide(grantedScopes: readonly string[]): boolean {
  return parseGoogleScopes(grantedScopes).some((scope) => {
    return !PICKER_TOKEN_SCOPES.has(scope)
  })
}

function scopeTooWide(
  logger: LoggerLike | undefined,
  stage: 'before-mint' | 'after-mint',
) {
  logger?.set({
    attributes: { googlePicker: { refused: 'scope-too-wide', stage } },
  })

  return createError({
    message: 'The Picker cannot use this Google connection',
    status: 409,
    code: GOOGLE_PICKER_SCOPE_TOO_WIDE_CODE,
    why: 'The grant holds more than Google Drive file access, and the '
      + 'token would reach the browser',
    fix: 'Disconnect Google Drive and connect it again',
    link: '/profile/keys?tab=google',
  })
}

/**
 * Mints the short-lived access token the browser gives to Google's Picker.
 * The token is the cached one while it has more than two minutes left, so
 * it is the shortest-lived token available without an extra Google call; a
 * new token (about an hour) is minted only when the cache is nearly spent.
 * The grant's scopes are checked before the mint and again after it, since
 * a refresh can store a different set.
 * This is the one place a Google token leaves the server. It is a token of
 * Besidka's own OAuth client only (never the owner's client, whose grant can
 * carry restricted scopes), it is the access token and never the refresh
 * token, it is refused when the stored grant holds any scope beyond identity
 * and `drive.file`, and it is minted through `getGoogleAccessToken` like
 * every other token use. Nothing here logs it.
 */
export async function createGooglePickerToken(
  input: GooglePickerTokenInput,
): Promise<GooglePickerTokenResult> {
  if (input.clientMode !== 'besidka') {
    throw createError({
      message: 'This Google connection cannot open the Picker',
      status: 403,
      code: GOOGLE_PICKER_CLIENT_REFUSED_CODE,
      why: 'Only Besidka\'s own Google client may hand a token to the browser',
      fix: 'Use Besidka\'s Google Drive connection',
    })
  }

  if (!input.apiKey || !input.projectNumber) {
    throw createError({
      message: 'The Google Picker is not configured',
      status: 503,
      code: GOOGLE_PICKER_NOT_CONFIGURED_CODE,
      why: 'The Picker API key or the Cloud project number is not set',
      fix: 'Ask the owner to set NUXT_PUBLIC_GOOGLE_PICKER_API_KEY and '
        + 'NUXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER',
    })
  }

  const connection = await readGoogleConnectionTokenState(
    input.db,
    input.userId,
    'besidka',
  )

  if (!connection || connection.status === 'revoked') {
    throw notConnected()
  }

  if (isGrantTooWide(connection.grantedScopes)) {
    throw scopeTooWide(input.logger, 'before-mint')
  }

  const token = await getGoogleAccessToken({
    userId: input.userId,
    clientMode: 'besidka',
    requiredScopes: [GOOGLE_SCOPES.driveFile],
  }, {
    db: input.db,
    kv: input.kv,
    logger: input.logger,
    now: input.now,
  })

  if (token.status === 'not_connected') {
    throw notConnected()
  }

  if (token.status === 'needs_reauth') {
    throw reauthorize('Google no longer accepts the stored authorization')
  }

  if (token.status === 'missing_scope') {
    throw reauthorize('The connection does not grant Google Drive file access')
  }

  const connectionAfterMint = await readGoogleConnectionTokenState(
    input.db,
    input.userId,
    'besidka',
  )

  if (
    !connectionAfterMint
    || isGrantTooWide(connectionAfterMint.grantedScopes)
  ) {
    throw scopeTooWide(input.logger, 'after-mint')
  }

  const now = (input.now ?? Date.now)()
  const expiresInSeconds = token.expiresAt
    ? Math.max(Math.floor((token.expiresAt.getTime() - now) / 1000), 0)
    : 0

  input.logger?.set({ attributes: { googlePicker: { token: 'issued' } } })

  return {
    accessToken: token.accessToken,
    expiresInSeconds,
    apiKey: input.apiKey,
    appId: input.projectNumber,
  }
}
