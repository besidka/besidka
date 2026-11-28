import type { RequestEvent } from 'nuxt/server'
import { MEMORY_TOOL_PERMISSION_WRITES_PER_MINUTE } from '#shared/utils/memory-tool-permissions'
import { createError } from 'evlog'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { assertConnectorWriteRequest } from '~~/server/utils/connectors/route'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const RATE_LIMIT_KEY_PREFIX = 'memory-tool-permissions-rate-limit'
const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS = 60

function tooManyRequests(event: RequestEvent, retryAfterSeconds: number) {
  event.res.headers.set('Retry-After', String(retryAfterSeconds))

  return createError({
    message: 'Too many permission changes',
    status: 429,
    why: 'At most '
      + `${MEMORY_TOOL_PERMISSION_WRITES_PER_MINUTE} `
      + 'memory permission changes are allowed per minute',
    fix: 'Wait a moment before retrying',
  })
}

/**
 * A flood guard for memory permission writes, per user. It fails closed:
 * when KV cannot count, the write is refused with `Retry-After: 60`.
 */
async function enforceWriteRateLimit(
  event: RequestEvent,
  userId: number,
): Promise<void> {
  let result: { allowed: boolean, retryAfter: number | null }

  try {
    const storage = createAuthRateLimitStorage(useKV(), RATE_LIMIT_KEY_PREFIX)

    result = await storage.consume(String(userId), {
      window: RATE_LIMIT_WINDOW_SECONDS,
      max: MEMORY_TOOL_PERMISSION_WRITES_PER_MINUTE,
    })
  } catch {
    useRequestLogger(event).set({
      attributes: { memoryToolPermissions: { rateLimit: 'unavailable' } },
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
 * The gate of the memory tool permission routes, in this order: the
 * same-origin write guard (writes only), a session, the `tool-approvals`
 * flag with its Labs toggle on (a 404 otherwise), then the write limit. It
 * is tied to `tool-approvals`, not to `besidka-tools`: the setting changes
 * how the approval policy treats `memory_write` and `memory_forget`.
 * Returns the session user id: the routes only ever touch that user's rows.
 */
export async function requireMemoryToolPermissionsAccess(
  event: RequestEvent,
  options: { write: boolean },
): Promise<number> {
  if (options.write) {
    assertConnectorWriteRequest(event)
  }

  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  await requireFeature(event, 'tool-approvals')

  const userId = parseInt(session.user.id)

  if (options.write) {
    await enforceWriteRateLimit(event, userId)
  }

  useRequestLogger(event).set({ userId })

  return userId
}
