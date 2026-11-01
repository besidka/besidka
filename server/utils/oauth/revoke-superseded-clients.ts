import { and, eq, inArray, ne } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { revokeConnectedApp } from '~~/server/utils/oauth/revoke-connected-app'

const MAX_JSON_DECODE_PASSES = 3
const JSON_TEXT_START = /^[[{"]/
const CLIENT_ID_CHUNK = 50

export interface OAuthClientIdentity {
  clientId: string
  name: string | null
  redirectUris: unknown
  createdAt: Date
}

export interface RevokedSupersededClient {
  clientId: string
  scopes: string[]
}

function normalizeName(name: string | null): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : ''
}

function decodeRedirectUris(value: unknown): unknown {
  let decoded: unknown = value

  for (let pass = 0; pass < MAX_JSON_DECODE_PASSES; pass++) {
    if (typeof decoded !== 'string') {
      break
    }

    const text = decoded.trim()

    if (!JSON_TEXT_START.test(text)) {
      return null
    }

    try {
      decoded = JSON.parse(text)
    } catch {
      return null
    }
  }

  return decoded
}

/**
 * Better Auth writes redirect URI lists pre-stringified into a column that
 * Drizzle declares as `json`, so a read can return an array, a JSON text or a
 * double-encoded JSON text. Returns a de-duplicated list of the string
 * entries, and an empty list for anything it cannot read.
 */
export function parseStoredRedirectUris(value: unknown): string[] {
  const decoded = decodeRedirectUris(value)

  if (!Array.isArray(decoded)) {
    return []
  }

  const uris = decoded.filter((entry): entry is string => {
    return typeof entry === 'string' && entry.trim().length > 0
  })

  return [...new Set(uris.map((uri) => {
    return uri.trim()
  }))]
}

function hasSameRedirectUris(first: string[], second: string[]): boolean {
  if (!first.length || first.length !== second.length) {
    return false
  }

  const secondSet = new Set(second)

  return first.every((uri) => {
    return secondSet.has(uri)
  })
}

/**
 * Picks the connections that a newly approved client replaces: another client
 * with the same name and the identical redirect URI set that was registered
 * strictly earlier, so a scope step-up on an older connection never revokes a
 * newer one.
 */
export function findSupersededClientIds(
  current: OAuthClientIdentity,
  candidates: OAuthClientIdentity[],
): string[] {
  const currentName = normalizeName(current.name)
  const currentRedirectUris = parseStoredRedirectUris(current.redirectUris)

  if (!currentName || !currentRedirectUris.length) {
    return []
  }

  return candidates
    .filter((candidate) => {
      return candidate.clientId !== current.clientId
        && normalizeName(candidate.name) === currentName
        && candidate.createdAt.getTime() < current.createdAt.getTime()
        && hasSameRedirectUris(
          currentRedirectUris,
          parseStoredRedirectUris(candidate.redirectUris),
        )
    })
    .map((candidate) => {
      return candidate.clientId
    })
}

/**
 * True when the consent endpoint answered with a redirect that carries an
 * authorization code and no error, the shape Better Auth returns
 * (`{ redirect: true, url }`) when the approval went through to
 * `redirectWithAuthorizationCode`. A consent that was merely re-routed
 * (`prompt=login`) or that ended in an error redirect never qualifies.
 */
export function isAuthorizationCodeRedirect(returned: unknown): boolean {
  if (typeof returned !== 'object' || returned === null) {
    return false
  }

  const { redirect, url } = returned as { redirect?: unknown, url?: unknown }

  if (redirect !== true || typeof url !== 'string') {
    return false
  }

  try {
    const { searchParams } = new URL(url)

    return Boolean(searchParams.get('code')) && !searchParams.has('error')
  } catch {
    return false
  }
}

async function findGrantedClientIds(
  db: ReturnType<typeof useDb>,
  userId: number,
  excludedClientId: string,
): Promise<string[]> {
  const grants = [
    await db.selectDistinct({ clientId: schema.oauthConsents.clientId })
      .from(schema.oauthConsents)
      .where(and(
        eq(schema.oauthConsents.userId, userId),
        ne(schema.oauthConsents.clientId, excludedClientId),
      )),
    await db.selectDistinct({ clientId: schema.oauthRefreshTokens.clientId })
      .from(schema.oauthRefreshTokens)
      .where(and(
        eq(schema.oauthRefreshTokens.userId, userId),
        ne(schema.oauthRefreshTokens.clientId, excludedClientId),
      )),
    await db.selectDistinct({ clientId: schema.oauthAccessTokens.clientId })
      .from(schema.oauthAccessTokens)
      .where(and(
        eq(schema.oauthAccessTokens.userId, userId),
        ne(schema.oauthAccessTokens.clientId, excludedClientId),
      )),
  ]

  return [...new Set(grants.flat().map((grant) => {
    return grant.clientId
  }))]
}

async function findClientsByIds(
  db: ReturnType<typeof useDb>,
  clientIds: string[],
): Promise<OAuthClientIdentity[]> {
  const clients: OAuthClientIdentity[] = []

  for (let start = 0; start < clientIds.length; start += CLIENT_ID_CHUNK) {
    const chunk = clientIds.slice(start, start + CLIENT_ID_CHUNK)
    const rows = await db.select({
      clientId: schema.oauthClients.clientId,
      name: schema.oauthClients.name,
      redirectUris: schema.oauthClients.redirectUris,
      createdAt: schema.oauthClients.createdAt,
    })
      .from(schema.oauthClients)
      .where(inArray(schema.oauthClients.clientId, chunk))

    clients.push(...rows)
  }

  return clients
}

/**
 * Ends the user's older connections to the same app after they approve a new
 * client. claude.ai registers a fresh client on every reconnect and never
 * revokes the previous one. Revokes one client at a time and propagates a D1
 * failure; the caller decides whether that may fail the approval.
 */
export async function revokeSupersededClients(
  db: ReturnType<typeof useDb>,
  userId: number,
  clientId: string,
): Promise<RevokedSupersededClient[]> {
  const [current] = await db.select({
    clientId: schema.oauthClients.clientId,
    name: schema.oauthClients.name,
    redirectUris: schema.oauthClients.redirectUris,
    createdAt: schema.oauthClients.createdAt,
  })
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.clientId, clientId))
    .limit(1)

  if (!current) {
    return []
  }

  const grantedClientIds = await findGrantedClientIds(db, userId, clientId)

  if (!grantedClientIds.length) {
    return []
  }

  const candidates = await findClientsByIds(db, grantedClientIds)
  const supersededClientIds = findSupersededClientIds(current, candidates)
  const revokedClients: RevokedSupersededClient[] = []

  for (const supersededClientId of supersededClientIds) {
    const revoked = await revokeConnectedApp(db, userId, supersededClientId)

    if (!revoked) {
      continue
    }

    revokedClients.push({
      clientId: supersededClientId,
      scopes: revoked.scopes,
    })
  }

  return revokedClients
}
