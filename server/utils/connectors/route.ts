import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { getRouterParam } from 'nuxt/server'
import { CONNECTOR_ROUTES_PER_MINUTE } from '#shared/utils/connectors-policy'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import { getConnector } from '~~/server/utils/connectors/store'
import type { ConnectorRecord } from '~~/server/utils/connectors/store'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const RATE_LIMIT_KEY_PREFIX = 'connectors-rate-limit'
const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS = 60
const CONNECTOR_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/

function tooManyRequests(event: RequestEvent, retryAfterSeconds: number) {
  event.res.headers.set('Retry-After', String(retryAfterSeconds))

  return createError({
    message: 'Too many connector requests',
    status: 429,
    why: `At most ${CONNECTOR_ROUTES_PER_MINUTE} connector changes are `
      + 'allowed per minute',
    fix: 'Wait a moment before retrying',
  })
}

/**
 * Ten connector actions a minute per user, shared by every mutating route
 * and the OAuth callback. Fails closed: when KV cannot count, the request is
 * refused with `Retry-After: 60`.
 */
export async function enforceConnectorRateLimit(
  event: RequestEvent,
  userId: number,
): Promise<void> {
  let result: { allowed: boolean, retryAfter: number | null }

  try {
    const storage = createAuthRateLimitStorage(useKV(), RATE_LIMIT_KEY_PREFIX)

    result = await storage.consume(String(userId), {
      window: RATE_LIMIT_WINDOW_SECONDS,
      max: CONNECTOR_ROUTES_PER_MINUTE,
    })
  } catch {
    useRequestLogger(event).set({
      attributes: { connectors: { rateLimit: 'unavailable' } },
    })

    throw tooManyRequests(event, RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS)
  }

  if (!result.allowed) {
    throw tooManyRequests(
      event,
      result.retryAfter ?? RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS,
    )
  }
}

/**
 * The common gate of the connector routes: a session, the `connectors` flag
 * (and `connectors.oauth` for sign-in routes), then the per-user limit.
 */
export async function requireConnectorAccess(
  event: RequestEvent,
  options: { oauth?: boolean, rateLimit?: boolean } = {},
): Promise<number> {
  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  await requireFeature(event, 'connectors')

  if (options.oauth) {
    await requireFeature(event, 'connectors.oauth')
  }

  const userId = parseInt(session.user.id)

  if (options.rateLimit !== false) {
    await enforceConnectorRateLimit(event, userId)
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
