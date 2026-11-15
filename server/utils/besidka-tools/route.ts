import type { RequestEvent } from 'nuxt/server'
import { BESIDKA_TOOL_PERMISSION_WRITES_PER_MINUTE } from '#shared/utils/besidka-tool-permissions'
import { createError } from 'evlog'
import { z } from 'zod'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { assertConnectorWriteRequest } from '~~/server/utils/connectors/route'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const RATE_LIMIT_KEY_PREFIX = 'besidka-tools-rate-limit'
const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS = 60

function tooManyRequests(event: RequestEvent, retryAfterSeconds: number) {
  event.res.headers.set('Retry-After', String(retryAfterSeconds))

  return createError({
    message: 'Too many permission changes',
    status: 429,
    why: 'At most '
      + `${BESIDKA_TOOL_PERMISSION_WRITES_PER_MINUTE} `
      + 'tool permission changes are allowed per minute',
    fix: 'Wait a moment before retrying',
  })
}

/**
 * A flood guard for permission writes, per user. The KV counter is a
 * read-then-write, so a few concurrent requests can slip over the limit. It
 * fails closed: when KV cannot count, the write is refused with
 * `Retry-After: 60`.
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
      max: BESIDKA_TOOL_PERMISSION_WRITES_PER_MINUTE,
    })
  } catch {
    useRequestLogger(event).set({
      attributes: { besidkaTools: { rateLimit: 'unavailable' } },
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
 * The gate of the Besidka tool permission routes, in this order: the
 * same-origin write guard (writes only), a session, the `besidka-tools`
 * flag with its Labs toggle on (a 404 otherwise), then the write limit.
 * Returns the session user id: the routes only ever touch that user's rows.
 */
export async function requireBesidkaToolsAccess(
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

  await requireFeature(event, 'besidka-tools')

  const userId = parseInt(session.user.id)

  if (options.write) {
    await enforceWriteRateLimit(event, userId)
  }

  useRequestLogger(event).set({ userId })

  return userId
}

function chatNotFoundError() {
  return createError({
    message: 'Chat not found.',
    status: 404,
  })
}

/**
 * The gate of the per-chat Besidka routes: `requireBesidkaToolsAccess`
 * first, then the chat, which must belong to the user (404 otherwise, also
 * for a malformed slug).
 */
export async function requireBesidkaChatAccess(
  event: RequestEvent,
  options: { write: boolean },
): Promise<{ userId: number, chatPublicId: string }> {
  const params = z.object({
    slug: z.ulid(),
  }).safeParse(getDecodedRouterParams(event))
  const userId = await requireBesidkaToolsAccess(event, options)

  if (params.error) {
    throw chatNotFoundError()
  }

  const chat = await useDb().query.chats.findFirst({
    where: { slug: params.data.slug, userId },
    columns: { id: true },
  })

  if (!chat) {
    throw chatNotFoundError()
  }

  return { userId, chatPublicId: chat.id }
}
