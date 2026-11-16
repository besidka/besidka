import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { getRequestHeader, getRouterParam } from 'nuxt/server'
import {
  CONNECTOR_ICON_ROUTES_PER_MINUTE,
  CONNECTOR_ROUTES_PER_MINUTE,
  CONNECTOR_SELECTION_WRITES_PER_MINUTE,
  REGISTRY_SEARCHES_PER_MINUTE,
} from '#shared/utils/connectors-policy'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import { consumeIconRateLimit } from '~~/server/utils/connectors/icon-rate-limit'
import { getConnector } from '~~/server/utils/connectors/store'
import type { ConnectorRecord } from '~~/server/utils/connectors/store'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { resolveRequestPublicOrigin } from '~~/server/utils/request-public-origin'

const RATE_LIMIT_KEY_PREFIX = 'connectors-rate-limit'
const SELECTION_RATE_LIMIT_KEY_PREFIX = 'connectors-selection-rate-limit'
const ICON_RATE_LIMIT_KEY_PREFIX = 'connectors-icon-rate-limit'
const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS = 60
const CONNECTOR_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/

const ALLOWED_FETCH_SITES: ReadonlySet<string> = new Set(['same-origin', 'none'])

function forbiddenWrite(why: string) {
  return createError({
    message: 'Forbidden',
    status: 403,
    why,
    fix: 'Make the change from the Besidka app',
  })
}

/**
 * The CSRF guard of the state-changing connector routes, run before any
 * KV or D1 work: `Sec-Fetch-Site`, when sent, must be `same-origin` (a
 * sibling subdomain's `same-site` is refused too), and `Origin` must be
 * present and equal the app's public origin for this request (the
 * configured base URL, or an allow-listed preview host).
 */
export function assertConnectorWriteRequest(event: RequestEvent): void {
  const fetchSite = getRequestHeader(event, 'sec-fetch-site')

  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) {
    throw forbiddenWrite('The request did not come from the same origin')
  }

  const origin = getRequestHeader(event, 'origin')

  if (!origin || origin !== resolveRequestPublicOrigin(event)) {
    throw forbiddenWrite('The request has no Origin of this app')
  }
}

export interface RateLimitBucket {
  prefix: string
  max: number
}

const DEFAULT_BUCKET: RateLimitBucket = {
  prefix: RATE_LIMIT_KEY_PREFIX,
  max: CONNECTOR_ROUTES_PER_MINUTE,
}

const SELECTION_BUCKET: RateLimitBucket = {
  prefix: SELECTION_RATE_LIMIT_KEY_PREFIX,
  max: CONNECTOR_SELECTION_WRITES_PER_MINUTE,
}

const ICON_BUCKET: RateLimitBucket = {
  prefix: ICON_RATE_LIMIT_KEY_PREFIX,
  max: CONNECTOR_ICON_ROUTES_PER_MINUTE,
}

function tooManyRequests(
  event: RequestEvent,
  retryAfterSeconds: number,
  max: number,
) {
  event.res.headers.set('Retry-After', String(retryAfterSeconds))

  return createError({
    message: 'Too many connector requests',
    status: 429,
    why: `At most ${max} connector changes are allowed per minute`,
    fix: 'Wait a moment before retrying',
  })
}

/**
 * Ten connector actions a minute per user, shared by every mutating route
 * (the OAuth callback has its own failure budget). The KV counter is a
 * read-then-write, not atomic, so concurrent requests can slip a few over
 * the limit; it is a flood guard, not exact accounting. Fails closed: when
 * KV cannot count, the request is refused with `Retry-After: 60`.
 */
export async function enforceConnectorRateLimit(
  event: RequestEvent,
  userId: number,
  bucket: RateLimitBucket = DEFAULT_BUCKET,
): Promise<void> {
  let result: { allowed: boolean, retryAfter: number | null }

  try {
    const storage = createAuthRateLimitStorage(useKV(), bucket.prefix)

    result = await storage.consume(String(userId), {
      window: RATE_LIMIT_WINDOW_SECONDS,
      max: bucket.max,
    })
  } catch {
    useRequestLogger(event).set({
      attributes: { connectors: { rateLimit: 'unavailable' } },
    })

    throw tooManyRequests(
      event,
      RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS,
      bucket.max,
    )
  }

  if (!result.allowed) {
    throw tooManyRequests(
      event,
      result.retryAfter ?? RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS,
      bucket.max,
    )
  }
}

function resolveBucket(options: { selection?: boolean }): RateLimitBucket {
  return options.selection ? SELECTION_BUCKET : DEFAULT_BUCKET
}

/**
 * The common gate of the connector routes, in this order: the write guard
 * (unless `write: false`, only the GET callback), a session, the
 * `connectors` flag (and `connectors.oauth` for sign-in routes), then the
 * per-user limit (`selection: true` uses the looser bucket of the per-chat
 * toggles, 60 a minute, so flipping switches in the picker is not throttled
 * like connecting a server; `icon: true` uses the icon budget of
 * `consumeIconRateLimit`, 300 a minute, written to KV at most once a
 * second). Ownership lookups come after it in the route.
 */
export async function requireConnectorAccess(
  event: RequestEvent,
  options: {
    oauth?: boolean
    rateLimit?: boolean
    selection?: boolean
    icon?: boolean
    write?: boolean
  } = {},
): Promise<number> {
  if (options.write !== false) {
    assertConnectorWriteRequest(event)
  }

  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  await requireFeature(event, 'connectors')

  if (options.oauth) {
    await requireFeature(event, 'connectors.oauth')
  }

  const userId = parseInt(session.user.id)

  if (options.rateLimit !== false && options.icon) {
    const result = await consumeIconRateLimit(
      useKV(),
      ICON_BUCKET.prefix,
      userId,
      ICON_BUCKET.max,
    )

    if (!result.allowed) {
      throw tooManyRequests(event, result.retryAfter ?? 60, ICON_BUCKET.max)
    }
  } else if (options.rateLimit !== false) {
    await enforceConnectorRateLimit(
      event,
      userId,
      resolveBucket(options),
    )
  }

  useRequestLogger(event).set({ userId })

  return userId
}

export function readConnectorIdParam(event: RequestEvent): string {
  const connectorId = getRouterParam(event, 'id')

  if (!connectorId || !CONNECTOR_ID_PATTERN.test(connectorId)) {
    throw createConnectorError('CONNECTOR_NOT_FOUND')
  }

  return connectorId
}

/**
 * Loads a connector the user owns, through the store's user-scoped read.
 * An id of another user and an unknown id both answer 404.
 */
export async function requireOwnedConnector(
  event: RequestEvent,
  userId: number,
): Promise<ConnectorRecord> {
  const connectorId = readConnectorIdParam(event)
  const connector = await getConnector(useDb(), userId, connectorId)

  if (!connector) {
    throw createConnectorError('CONNECTOR_NOT_FOUND')
  }

  useRequestLogger(event).set({
    attributes: {
      connectors: { id: connector.id, host: new URL(connector.origin).host },
    },
  })

  return connector
}

/**
 * The gate of the directory routes: a session, the `connectors` and
 * `connectors.registry` flags, then the directory bucket (60 a minute, or
 * the given bucket). Read-only, so no write guard.
 */
export async function requireRegistryAccess(
  event: RequestEvent,
  bucket: RateLimitBucket = {
    prefix: 'connectors-registry-rate-limit',
    max: REGISTRY_SEARCHES_PER_MINUTE,
  },
): Promise<number> {
  const userId = await requireConnectorAccess(event, {
    write: false,
    rateLimit: false,
  })

  await requireFeature(event, 'connectors.registry')
  await enforceConnectorRateLimit(event, userId, bucket)

  return userId
}
