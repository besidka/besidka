import type { KVNamespace } from '@cloudflare/workers-types'
import {
  CONNECTOR_HEADER_NAME_PATTERN,
  CONNECTOR_HEADER_VALUE_MAX_BYTES,
  CONNECTOR_KV_MIN_TTL_SECONDS,
  CONNECTOR_REFRESH_LOCK_TTL_SECONDS,
  CONNECTOR_REFRESH_LOCK_WAIT_ATTEMPTS,
  CONNECTOR_REFRESH_LOCK_WAIT_MS,
  CONNECTOR_REFRESH_SKEW_SECONDS,
  CONNECTOR_REJECTED_HEADER_NAMES,
} from '#shared/utils/connectors-policy'
import {
  CONNECTOR_ERRORS,
  connectorErrorCodeOf,
  createConnectorError,
} from '~~/server/utils/connectors/errors'
import { refreshAccessToken } from '~~/server/utils/connectors/oauth-client'
import {
  compareAndDeleteConnectorCredentials,
  compareAndSetConnectorTokens,
  readConnectorCredentials,
  updateConnector,
} from '~~/server/utils/connectors/store'
import type { ConnectorCredentials } from '~~/server/utils/connectors/store'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

const REFRESH_LOCK_KEY_PREFIX = 'connectors:refresh:'
const FORBIDDEN_HEADER_CHAR_CODES: ReadonlySet<number> = new Set([0, 10, 13])
const MAX_HEADER_CHAR_CODE = 0xFF
const textEncoder = new TextEncoder()

export interface ConnectorTokenDependencies {
  db: DbClient
  kv: KVNamespace
  logger?: LoggerLike
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
  inFlight?: Map<string, Promise<string | null>>
}

export interface AccessTokenRequest {
  userId: number
  connectorId: string
  rejectedToken?: string
}

interface RefreshLockValue {
  owner: string
  acquiredAt: number
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function hasForbiddenHeaderCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)

    if (FORBIDDEN_HEADER_CHAR_CODES.has(code) || code > MAX_HEADER_CHAR_CODE) {
      return true
    }
  }

  return false
}

export function isValidConnectorHeader(name: string, value: string): boolean {
  if (!CONNECTOR_HEADER_NAME_PATTERN.test(name)) {
    return false
  }

  if (CONNECTOR_REJECTED_HEADER_NAMES.includes(name.toLowerCase())) {
    return false
  }

  if (!value.trim() || hasForbiddenHeaderCharacter(value)) {
    return false
  }

  return textEncoder.encode(value).byteLength
    <= CONNECTOR_HEADER_VALUE_MAX_BYTES
}

function logRefresh(
  logger: LoggerLike | undefined,
  connectorId: string,
  outcome: string,
) {
  logger?.set({
    attributes: {
      connectors: { id: connectorId, step: 'refresh', refresh: outcome },
    },
  })
}

function refreshLockKey(connectorId: string): string {
  return `${REFRESH_LOCK_KEY_PREFIX}${connectorId}`
}

function parseLock(raw: string | null): RefreshLockValue | null {
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as RefreshLockValue
  } catch {
    return null
  }
}

/**
 * Best-effort refresh lock (docs/connectors.md section 5.4): read, write a
 * random owner, read again. KV is eventually consistent and has no
 * compare-and-set, so two locations can both win; the D1 compare-and-set on
 * the token generation is what keeps the stored tokens right. KV refuses a
 * TTL under 60 s, so the entry lives 60 s and carries its own 30 s expiry.
 */
async function acquireRefreshLock(
  kv: KVNamespace,
  connectorId: string,
  now: number,
): Promise<string | null> {
  const key = refreshLockKey(connectorId)
  const existing = parseLock(await kv.get(key))

  if (
    existing
    && now - existing.acquiredAt < CONNECTOR_REFRESH_LOCK_TTL_SECONDS * 1000
  ) {
    return null
  }

  const owner = crypto.randomUUID()

  await kv.put(key, JSON.stringify({ owner, acquiredAt: now }), {
    expirationTtl: Math.max(
      CONNECTOR_REFRESH_LOCK_TTL_SECONDS,
      CONNECTOR_KV_MIN_TTL_SECONDS,
    ),
  })

  const confirmed = parseLock(await kv.get(key))

  return confirmed?.owner === owner ? owner : null
}

async function releaseRefreshLock(
  kv: KVNamespace,
  connectorId: string,
  owner: string,
): Promise<void> {
  try {
    const key = refreshLockKey(connectorId)

    if (parseLock(await kv.get(key))?.owner === owner) {
      await kv.delete(key)
    }
  } catch {
    return
  }
}

function needsRefresh(credentials: ConnectorCredentials, now: number): boolean {
  if (!credentials.expiresAt) {
    return false
  }

  return credentials.expiresAt.getTime() - now
    < CONNECTOR_REFRESH_SKEW_SECONDS * 1000
}

async function markNeedsReauth(
  request: AccessTokenRequest,
  credentials: ConnectorCredentials,
  dependencies: ConnectorTokenDependencies,
): Promise<void> {
  const deleted = await compareAndDeleteConnectorCredentials(dependencies.db, {
    userId: request.userId,
    connectorId: request.connectorId,
    expectedGeneration: credentials.generation,
  })

  if (!deleted) {
    return
  }

  const text = CONNECTOR_ERRORS.CONNECTOR_REAUTH_REQUIRED

  await updateConnector(dependencies.db, request.userId, request.connectorId, {
    status: 'needs-auth',
    lastError: { code: 'CONNECTOR_REAUTH_REQUIRED', message: text.message },
  })
}

async function readLatestToken(
  request: AccessTokenRequest,
  dependencies: ConnectorTokenDependencies,
): Promise<ConnectorCredentials | null> {
  return await readConnectorCredentials(
    dependencies.db,
    request.userId,
    request.connectorId,
  )
}

async function performRefresh(
  request: AccessTokenRequest,
  credentials: ConnectorCredentials,
  dependencies: ConnectorTokenDependencies,
): Promise<string | null> {
  const registration = credentials.clientRegistration

  if (!credentials.refreshToken || !registration?.tokenEndpoint) {
    logRefresh(dependencies.logger, request.connectorId, 'no-refresh-token')
    await markNeedsReauth(request, credentials, dependencies)

    return null
  }

  let result: Awaited<ReturnType<typeof refreshAccessToken>>

  try {
    result = await refreshAccessToken({
      registration,
      refreshToken: credentials.refreshToken,
      logger: dependencies.logger,
    })
  } catch (exception) {
    logRefresh(
      dependencies.logger,
      request.connectorId,
      connectorErrorCodeOf(exception, 'CONNECTOR_REFRESH_FAILED'),
    )

    throw createConnectorError('CONNECTOR_REFRESH_FAILED')
  }

  if (!result.ok) {
    if (!result.invalidGrant) {
      logRefresh(dependencies.logger, request.connectorId, 'failed')

      throw createConnectorError('CONNECTOR_REFRESH_FAILED')
    }

    const latest = await readLatestToken(request, dependencies)

    if (latest?.accessToken && latest.generation !== credentials.generation) {
      logRefresh(dependencies.logger, request.connectorId, 'superseded')

      return latest.accessToken
    }

    logRefresh(dependencies.logger, request.connectorId, 'invalid-grant')
    await markNeedsReauth(request, credentials, dependencies)

    return null
  }

  const { tokens } = result
  const saved = await compareAndSetConnectorTokens(dependencies.db, {
    userId: request.userId,
    connectorId: request.connectorId,
    expectedGeneration: credentials.generation,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? credentials.refreshToken,
    scope: tokens.scope ?? credentials.scope,
    expiresAt: tokens.expiresAt,
  })

  if (!saved) {
    logRefresh(dependencies.logger, request.connectorId, 'lost-race')

    return (await readLatestToken(request, dependencies))?.accessToken ?? null
  }

  logRefresh(dependencies.logger, request.connectorId, 'refreshed')

  return tokens.accessToken
}

async function isRefreshLockHeld(
  kv: KVNamespace,
  connectorId: string,
  now: number,
): Promise<boolean> {
  try {
    const lock = parseLock(await kv.get(refreshLockKey(connectorId)))

    return lock !== null
      && now - lock.acquiredAt < CONNECTOR_REFRESH_LOCK_TTL_SECONDS * 1000
  } catch {
    return false
  }
}

/**
 * Refreshes under the lock. A caller that loses it waits up to three times
 * for the owner's new token; if the owner still holds the lock after that,
 * the caller gives up with a retryable error instead of sending the same
 * refresh token again, which an issuer that rotates refresh tokens treats
 * as reuse. When KV itself fails, the refresh runs without a lock.
 */
async function refreshUnderLock(
  request: AccessTokenRequest,
  credentials: ConnectorCredentials,
  dependencies: ConnectorTokenDependencies,
): Promise<string | null> {
  const now = dependencies.now ?? Date.now
  const wait = dependencies.wait ?? defaultWait
  let owner: string | null = null
  let lockUnavailable = false

  try {
    owner = await acquireRefreshLock(
      dependencies.kv,
      request.connectorId,
      now(),
    )
  } catch {
    lockUnavailable = true
    logRefresh(dependencies.logger, request.connectorId, 'lock-unavailable')
  }

  if (!owner && !lockUnavailable) {
    for (
      let attempt = 0;
      attempt < CONNECTOR_REFRESH_LOCK_WAIT_ATTEMPTS;
      attempt++
    ) {
      await wait(CONNECTOR_REFRESH_LOCK_WAIT_MS)

      const latest = await readLatestToken(request, dependencies)

      if (!latest?.accessToken) {
        return null
      }

      if (latest.generation !== credentials.generation) {
        logRefresh(dependencies.logger, request.connectorId, 'waited')

        return latest.accessToken
      }
    }

    if (await isRefreshLockHeld(dependencies.kv, request.connectorId, now())) {
      logRefresh(dependencies.logger, request.connectorId, 'lock-busy')

      throw createConnectorError('CONNECTOR_REFRESH_FAILED')
    }
  }

  try {
    return await performRefresh(request, credentials, dependencies)
  } finally {
    if (owner) {
      await releaseRefreshLock(dependencies.kv, request.connectorId, owner)
    }
  }
}

async function resolveAccessToken(
  request: AccessTokenRequest,
  dependencies: ConnectorTokenDependencies,
): Promise<string | null> {
  const now = (dependencies.now ?? Date.now)()
  const credentials = await readLatestToken(request, dependencies)

  if (!credentials?.accessToken) {
    return null
  }

  if (request.rejectedToken !== undefined) {
    if (credentials.accessToken !== request.rejectedToken) {
      return credentials.accessToken
    }
  } else if (!needsRefresh(credentials, now)) {
    return credentials.accessToken
  }

  return await refreshUnderLock(request, credentials, dependencies)
}

/**
 * The access token for a connector's next request (docs/connectors.md
 * section 5.4), or null when it must sign in again. Refreshes when the token
 * expires within 60 s, or when the caller passes the token a server just
 * rejected with 401 and that token is still the stored one. Concurrent
 * calls sharing `inFlight` (one per request, never module-wide) share one
 * refresh; across requests the KV lock reduces and the D1 compare-and-set
 * settles duplicate refreshes. The token is never logged.
 */
export async function getValidAccessToken(
  request: AccessTokenRequest,
  dependencies: ConnectorTokenDependencies,
): Promise<string | null> {
  const inFlightKey = `${request.userId}:${request.connectorId}`
  const pending = dependencies.inFlight?.get(inFlightKey)

  if (pending) {
    return await pending
  }

  const promise = resolveAccessToken(request, dependencies)

  dependencies.inFlight?.set(inFlightKey, promise)

  try {
    return await promise
  } finally {
    dependencies.inFlight?.delete(inFlightKey)
  }
}
