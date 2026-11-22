import {
  GOOGLE_CAPABILITIES,
  GOOGLE_SCOPE_CAPABILITIES,
  hasScopes,
} from '#shared/utils/google-scopes'
import type {
  GoogleCapability,
  GoogleClientMode,
} from '#shared/utils/google-scopes'
import type { GoogleByoStatus } from '#shared/utils/google-byo'

export const GOOGLE_CONNECTION_STATUSES = [
  'active',
  'needs_reauth',
  'revoked',
] as const

export type GoogleConnectionStatus = typeof GOOGLE_CONNECTION_STATUSES[number]

export const GOOGLE_CONNECT_RESULT_QUERY_KEY = 'google'

export const GOOGLE_CONNECT_RESULTS = [
  'connected',
  'partial',
  'denied',
  'missing_scope',
  'expired',
  'error',
] as const

export type GoogleConnectResult = typeof GOOGLE_CONNECT_RESULTS[number]

export const GOOGLE_CONNECT_DEFAULT_RETURN_PATH = '/profile/keys?tab=google'

export interface GoogleConnectionSummary {
  clientMode: GoogleClientMode
  status: GoogleConnectionStatus
  email: string | null
  capabilities: GoogleCapability[]
  connectedAt: string
}

export interface GoogleByoConnectionStatus extends GoogleByoStatus {
  connection: GoogleConnectionSummary | null
}

export interface GoogleConnectionStatusResponse {
  connection: GoogleConnectionSummary | null
  canConnect: boolean
  dedicatedClient: boolean
  byo: GoogleByoConnectionStatus | null
}

export const GOOGLE_THIRD_PARTY_ACCESS_URL
  = 'https://myaccount.google.com/connections'

export function getGrantedCapabilities(
  grantedScopes: readonly string[],
): GoogleCapability[] {
  return GOOGLE_CAPABILITIES.filter((capability) => {
    return hasScopes(
      grantedScopes,
      GOOGLE_SCOPE_CAPABILITIES[capability].scopes,
    )
  })
}

export function isGoogleConnectResult(
  value: unknown,
): value is GoogleConnectResult {
  return GOOGLE_CONNECT_RESULTS.some((result) => {
    return result === value
  })
}
