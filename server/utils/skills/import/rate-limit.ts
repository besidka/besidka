import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
import {
  SKILL_IMPORTS_PER_HOUR,
} from '#shared/utils/skills-policy'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const RATE_LIMIT_KEY_PREFIX = 'skills-import-rate-limit'
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60

/**
 * Ten imports an hour per user, counted where the CPU and R2 work starts:
 * the preview and the paste route. A commit needs a stage that already
 * passed it. The KV counter fails open, because a failed counter write must
 * not turn into a 500, while a stored count over the limit still answers 429.
 */
export async function enforceSkillImportRateLimit(
  event: RequestEvent,
  userId: number,
): Promise<void> {
  const storage = createAuthRateLimitStorage(useKV(), RATE_LIMIT_KEY_PREFIX)
  let result: Awaited<ReturnType<typeof storage.consume>>

  try {
    result = await storage.consume(String(userId), {
      window: RATE_LIMIT_WINDOW_SECONDS,
      max: SKILL_IMPORTS_PER_HOUR,
    })
  } catch (exception) {
    useRequestLogger(event).set({
      attributes: {
        skills: {
          rateLimit: {
            failedOpen: true,
            error: exceptionMessage(exception),
          },
        },
      },
    })

    return
  }

  if (result.allowed) {
    return
  }

  if (result.retryAfter !== null) {
    event.res.headers.set('Retry-After', String(result.retryAfter))
  }

  throw createError({
    message: 'Too many skill imports',
    status: 429,
    why: `At most ${SKILL_IMPORTS_PER_HOUR} skills can be imported per hour`,
    fix: 'Try again later',
  })
}
