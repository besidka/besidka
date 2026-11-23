import {
  GOOGLE_CONNECTORS_PATH,
  GOOGLE_KEYS_TAB_PATH,
} from '#shared/utils/google-connectors'
import {
  GOOGLE_CAPABILITIES,
  GOOGLE_SCOPES,
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

export const GOOGLE_CONNECT_DEFAULT_RETURN_PATH = GOOGLE_CONNECTORS_PATH

export const GOOGLE_CONNECT_KEYS_RETURN_PATH = GOOGLE_KEYS_TAB_PATH

export type GooglePartialCalendarAccess = 'events' | 'free-busy'

/**
 * `partialCalendar` is present only when exactly one of the two Calendar
 * permissions was granted (the `calendar` capability needs both): `events`
 * for listing and creating events, `free-busy` for the free and busy time.
 */
export interface GoogleConnectionSummary {
  clientMode: GoogleClientMode
  status: GoogleConnectionStatus
  email: string | null
  isWorkspaceAccount: boolean
  capabilities: GoogleCapability[]
  partialCalendar?: GooglePartialCalendarAccess
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

const PERSONAL_GOOGLE_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
]

/**
 * Whether a connected account is a Google Workspace account, from the
 * domain of the stored account email: `gmail.com` and `googlemail.com` are
 * personal accounts, any other domain is Workspace. An account with no
 * stored email, or one that is not an address, is not treated as Workspace.
 * This is a guess from the domain (a personal account can use another
 * domain), made only to decide which Picker tabs to show.
 */
export function isWorkspaceAccountEmail(email: string | null): boolean {
  const separator = email?.lastIndexOf('@') ?? -1

  if (!email || separator < 1 || separator === email.length - 1) {
    return false
  }

  const domain = email.slice(separator + 1).trim().toLowerCase()

  return !!domain && !PERSONAL_GOOGLE_DOMAINS.includes(domain)
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

export function getPartialCalendarAccess(
  grantedScopes: readonly string[],
): GooglePartialCalendarAccess | null {
  const hasEvents = hasScopes(
    grantedScopes,
    [GOOGLE_SCOPES.calendarEventsOwned],
  )
  const hasFreeBusy = hasScopes(
    grantedScopes,
    [GOOGLE_SCOPES.calendarEventsFreebusy],
  )

  if (hasEvents === hasFreeBusy) {
    return null
  }

  return hasEvents ? 'events' : 'free-busy'
}

export function isGoogleConnectResult(
  value: unknown,
): value is GoogleConnectResult {
  return GOOGLE_CONNECT_RESULTS.some((result) => {
    return result === value
  })
}
