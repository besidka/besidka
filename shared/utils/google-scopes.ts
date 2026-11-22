export const GOOGLE_CLIENT_MODES = ['besidka', 'byo'] as const

export type GoogleClientMode = typeof GOOGLE_CLIENT_MODES[number]

export type GoogleScopeClassification
  = 'non-sensitive' | 'sensitive' | 'restricted' | 'unconfirmed'

const GOOGLE_AUTH_PREFIX = 'https://www.googleapis.com/auth/'

export const GOOGLE_SCOPES = {
  openid: 'openid',
  email: `${GOOGLE_AUTH_PREFIX}userinfo.email`,
  profile: `${GOOGLE_AUTH_PREFIX}userinfo.profile`,
  driveFile: `${GOOGLE_AUTH_PREFIX}drive.file`,
  driveReadonly: `${GOOGLE_AUTH_PREFIX}drive.readonly`,
  gmailReadonly: `${GOOGLE_AUTH_PREFIX}gmail.readonly`,
  gmailCompose: `${GOOGLE_AUTH_PREFIX}gmail.compose`,
  calendarEvents: `${GOOGLE_AUTH_PREFIX}calendar.events`,
} as const

export type GoogleScope = typeof GOOGLE_SCOPES[keyof typeof GOOGLE_SCOPES]

export const GOOGLE_CAPABILITIES = [
  'identity',
  'drive-picked',
  'drive-read',
  'gmail-read',
  'gmail-compose',
  'calendar',
] as const

export type GoogleCapability = typeof GOOGLE_CAPABILITIES[number]

export interface GoogleScopeCapability {
  scopes: readonly GoogleScope[]
  clients: readonly GoogleClientMode[]
  classification: GoogleScopeClassification
  provisional: boolean
}

export const GOOGLE_SCOPE_CAPABILITIES: Readonly<
  Record<GoogleCapability, GoogleScopeCapability>
> = {
  'identity': {
    scopes: [GOOGLE_SCOPES.openid, GOOGLE_SCOPES.email, GOOGLE_SCOPES.profile],
    clients: ['besidka', 'byo'],
    classification: 'non-sensitive',
    provisional: false,
  },
  'drive-picked': {
    scopes: [GOOGLE_SCOPES.driveFile],
    clients: ['besidka'],
    classification: 'non-sensitive',
    provisional: false,
  },
  'drive-read': {
    scopes: [GOOGLE_SCOPES.driveReadonly],
    clients: ['byo'],
    classification: 'restricted',
    provisional: false,
  },
  'gmail-read': {
    scopes: [GOOGLE_SCOPES.gmailReadonly],
    clients: ['byo'],
    classification: 'restricted',
    provisional: false,
  },
  'gmail-compose': {
    scopes: [GOOGLE_SCOPES.gmailCompose],
    clients: ['byo'],
    classification: 'restricted',
    provisional: false,
  },
  'calendar': {
    scopes: [GOOGLE_SCOPES.calendarEvents],
    clients: ['besidka', 'byo'],
    classification: 'unconfirmed',
    provisional: true,
  },
}

const GOOGLE_SCOPE_ALIASES: Readonly<Record<string, string>> = {
  email: GOOGLE_SCOPES.email,
  profile: GOOGLE_SCOPES.profile,
}

export function normalizeGoogleScope(scope: string): string {
  const trimmed = scope.trim()

  return GOOGLE_SCOPE_ALIASES[trimmed] ?? trimmed
}

export function parseGoogleScopes(
  granted: string | readonly string[],
): string[] {
  const rawScopes = typeof granted === 'string' ? [granted] : granted
  const scopes = new Set<string>()

  for (const rawScope of rawScopes) {
    for (const scope of rawScope.split(/\s+/)) {
      if (scope) {
        scopes.add(normalizeGoogleScope(scope))
      }
    }
  }

  return [...scopes]
}

export function hasScopes(
  granted: string | readonly string[],
  required: readonly string[],
): boolean {
  const grantedScopes = new Set(parseGoogleScopes(granted))

  return parseGoogleScopes(required).every((scope) => {
    return grantedScopes.has(scope)
  })
}

export function isCapabilityAllowedForClient(
  capability: GoogleCapability,
  clientMode: GoogleClientMode,
): boolean {
  return GOOGLE_SCOPE_CAPABILITIES[capability].clients.includes(clientMode)
}

export function getScopesForClient(
  clientMode: GoogleClientMode,
): GoogleScope[] {
  const scopes = new Set<GoogleScope>()

  for (const capability of GOOGLE_CAPABILITIES) {
    if (!isCapabilityAllowedForClient(capability, clientMode)) {
      continue
    }

    for (const scope of GOOGLE_SCOPE_CAPABILITIES[capability].scopes) {
      scopes.add(scope)
    }
  }

  return [...scopes]
}

export function getCapabilityScopes(
  capabilities: readonly GoogleCapability[],
): GoogleScope[] {
  const scopes = new Set<GoogleScope>()

  for (const capability of capabilities) {
    for (const scope of GOOGLE_SCOPE_CAPABILITIES[capability].scopes) {
      scopes.add(scope)
    }
  }

  return [...scopes]
}
