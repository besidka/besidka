import type { KVNamespace } from '@cloudflare/workers-types'
import {
  CONNECTOR_CALLS_PER_MINUTE,
  CONNECTOR_CALLS_PER_MINUTE_PER_CONNECTOR,
  CONNECTOR_RATE_LIMIT_WINDOW_SECONDS,
} from '#shared/utils/connectors-policy'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'

const USER_KEY_PREFIX = 'connectors-calls-user'
const CONNECTOR_KEY_PREFIX = 'connectors-calls-connector'

export type ConnectorCallLimiter = (
  userId: number,
  connectorId: string,
) => Promise<boolean>

/**
 * 60 calls a minute per user and 30 per user and connector, counted in KV
 * (a read-then-write, a flood guard rather than exact accounting). It fails
 * closed: when KV cannot count, the call is refused.
 */
export function createConnectorCallLimiter(
  kv: KVNamespace,
): ConnectorCallLimiter {
  const userStorage = createAuthRateLimitStorage(kv, USER_KEY_PREFIX)
  const connectorStorage = createAuthRateLimitStorage(
    kv,
    CONNECTOR_KEY_PREFIX,
  )

  return async (userId, connectorId) => {
    try {
      const user = await userStorage.consume(String(userId), {
        window: CONNECTOR_RATE_LIMIT_WINDOW_SECONDS,
        max: CONNECTOR_CALLS_PER_MINUTE,
      })

      if (!user.allowed) {
        return false
      }

      const connector = await connectorStorage.consume(
        `${userId}:${connectorId}`,
        {
          window: CONNECTOR_RATE_LIMIT_WINDOW_SECONDS,
          max: CONNECTOR_CALLS_PER_MINUTE_PER_CONNECTOR,
        },
      )

      return connector.allowed
    } catch {
      return false
    }
  }
}
