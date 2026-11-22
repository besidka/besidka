import {
  getCapabilityScopes,
  isCapabilityAllowedForClient,
} from '#shared/utils/google-scopes'
import type { GoogleCapability, GoogleScope } from '#shared/utils/google-scopes'

export const GOOGLE_BYO_FEATURE_FLAG = 'google.byo'
export const GOOGLE_GMAIL_FEATURE_FLAG = 'google.gmail'

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

const GOOGLE_CLIENT_ID_PATTERN
  = /^[0-9a-z][0-9a-z-]*\.apps\.googleusercontent\.com$/
const GOOGLE_CLIENT_SECRET_PATTERN = /^[\x21-\x7E]+$/

/**
 * The bring-your-own part of the Google status. `canManage` is true only
 * for a user who passes the admin and `google.byo` gate; everyone else who
 * still holds a stored client or a connection gets `canManage: false` and
 * may only remove them. `hasClient` says whether a client is saved, never
 * which one.
 */
export interface GoogleByoStatus {
  canManage: boolean
  redirectUri: string | null
  hasClient: boolean
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
