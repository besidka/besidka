import type { KVNamespace } from '@cloudflare/workers-types'
import {
  CONNECTOR_CALLS_PER_MINUTE,
  CONNECTOR_CALLS_PER_MINUTE_PER_CONNECTOR,
  CONNECTOR_RATE_LIMIT_WINDOW_SECONDS,
} from '#shared/utils/connectors-policy'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

const USER_KEY_PREFIX = 'connectors-calls-user'
const CONNECTOR_KEY_PREFIX = 'connectors-calls-connector'
const KV_RETRY_DELAY_MS = 1_100

function wait(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs))
}

export type ConnectorCallLimitResult
  = | { status: 'allowed' }
    | {
      status: 'limited'
      scope: 'user' | 'connector'
      retryAfterSeconds: number
    }
    | { status: 'kv-error', error: string }

export type ConnectorCallLimiter = (
  userId: number,
  connectorId: string,
) => Promise<ConnectorCallLimitResult>

/**
 * 60 calls a minute per user and 30 per user and connector, counted in KV
 * (a read-then-write, a flood guard rather than exact accounting). The
 * counts of one send are taken one at a time: KV takes about one write a
 * second per key, and parallel calls of one step used to write the same two
 * keys at once, so KV refused the writes and every call read as over the
 * limit (owner report, 2026-11-20). A KV failure is retried once after a
 * second (KV's write rate per key), then reported as `kv-error`, never as
 * a limit: the caller logs it and lets the call run,
 * because the per-message caps (`CONNECTOR_CALLS_PER_TURN`, at most three
 * calls in flight) still bound the send.
 */
export function createConnectorCallLimiter(
  kv: KVNamespace,
): ConnectorCallLimiter {
  const userStorage = createAuthRateLimitStorage(kv, USER_KEY_PREFIX)
  const connectorStorage = createAuthRateLimitStorage(
    kv,
    CONNECTOR_KEY_PREFIX,
  )
  let queue: Promise<unknown> = Promise.resolve()

  async function consume(
    userId: number,
    connectorId: string,
  ): Promise<ConnectorCallLimitResult> {
    try {
      const user = await userStorage.consume(String(userId), {
        window: CONNECTOR_RATE_LIMIT_WINDOW_SECONDS,
        max: CONNECTOR_CALLS_PER_MINUTE,
      })

      if (!user.allowed) {
        return {
          status: 'limited',
          scope: 'user',
          retryAfterSeconds: Math.max(1, user.retryAfter ?? 1),
        }
      }

      const connector = await connectorStorage.consume(
        `${userId}:${connectorId}`,
        {
          window: CONNECTOR_RATE_LIMIT_WINDOW_SECONDS,
          max: CONNECTOR_CALLS_PER_MINUTE_PER_CONNECTOR,
        },
      )

      return connector.allowed
        ? { status: 'allowed' }
        : {
          status: 'limited',
          scope: 'connector',
          retryAfterSeconds: Math.max(1, connector.retryAfter ?? 1),
        }
    } catch (exception) {
      return { status: 'kv-error', error: exceptionMessage(exception) }
    }
  }

  async function consumeWithRetry(
    userId: number,
    connectorId: string,
  ): Promise<ConnectorCallLimitResult> {
    const first = await consume(userId, connectorId)

    if (first.status !== 'kv-error') {
      return first
    }

    await wait(KV_RETRY_DELAY_MS)

    return await consume(userId, connectorId)
  }

  return (userId, connectorId) => {
    const result = queue.then(() => consumeWithRetry(userId, connectorId))

    queue = result.catch(() => undefined)

    return result
  }
}
