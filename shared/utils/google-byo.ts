import {
  getCapabilityScopes,
  isCapabilityAllowedForClient,
} from '#shared/utils/google-scopes'
import type { GoogleCapability, GoogleScope } from '#shared/utils/google-scopes'

export const GOOGLE_BYO_FEATURE_FLAG = 'google.byo'

export const GOOGLE_BYO_KEY_PROVIDER = 'google-oauth-client'

export const GOOGLE_BYO_CALLBACK_PATH = '/api/v1/google/byo/callback'

export const GOOGLE_BYO_RESULT_QUERY_KEY = 'google-byo'

export const GOOGLE_BYO_CAPABILITIES = [
  'drive-read',
  'gmail-read',
  'gmail-compose',
  'calendar',
] as const satisfies readonly GoogleCapability[]

export type GoogleByoCapability = typeof GOOGLE_BYO_CAPABILITIES[number]

export const GOOGLE_OAUTH_CLIENT_ID_MAX_LENGTH = 200
export const GOOGLE_OAUTH_CLIENT_SECRET_MIN_LENGTH = 20
export const GOOGLE_OAUTH_CLIENT_SECRET_MAX_LENGTH = 128

const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com'
const GOOGLE_CLIENT_ID_PATTERN
  = /^[0-9a-z][0-9a-z-]*\.apps\.googleusercontent\.com$/
const GOOGLE_CLIENT_SECRET_PATTERN = /^[\x21-\x7E]+$/
const CLIENT_ID_HINT_LENGTH = 4

export interface GoogleByoClientSummary {
  clientIdHint: string
}

export interface GoogleByoStatus {
  canManage: boolean
  redirectUri: string | null
  client: GoogleByoClientSummary | null
}

export function isGoogleOAuthClientId(value: string): boolean {
  return value.length <= GOOGLE_OAUTH_CLIENT_ID_MAX_LENGTH
    && GOOGLE_CLIENT_ID_PATTERN.test(value)
}

export function isGoogleOAuthClientSecret(value: string): boolean {
  return value.length >= GOOGLE_OAUTH_CLIENT_SECRET_MIN_LENGTH
    && value.length <= GOOGLE_OAUTH_CLIENT_SECRET_MAX_LENGTH
    && GOOGLE_CLIENT_SECRET_PATTERN.test(value)
}

/**
 * The last four characters of a client id before the Google suffix: enough
 * for the owner to recognize which client is stored, and nothing a caller
 * could use, since a client id alone is a public value anyway.
 */
export function googleClientIdHint(clientId: string): string {
  const base = clientId.endsWith(GOOGLE_CLIENT_ID_SUFFIX)
    ? clientId.slice(0, -GOOGLE_CLIENT_ID_SUFFIX.length)
    : clientId

  return base.slice(-CLIENT_ID_HINT_LENGTH)
}

export function isGoogleByoCapability(
  value: unknown,
): value is GoogleByoCapability {
  return GOOGLE_BYO_CAPABILITIES.some((capability) => {
    return capability === value
  })
}

/**
 * The scopes the bring-your-own client asks Google for, from capability
 * names only: a caller never sends scope strings. A capability that the
 * scope map does not allow for the `byo` client is dropped.
 */
export function getGoogleByoScopes(
  capabilities: readonly GoogleByoCapability[],
): GoogleScope[] {
  const allowed = capabilities.filter((capability) => {
    return isCapabilityAllowedForClient(capability, 'byo')
  })

  return getCapabilityScopes(allowed)
}
