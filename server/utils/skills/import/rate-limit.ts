import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
// @ts-ignore
import { env } from 'cloudflare:workers'
import { SKILL_IMPORTS_PER_HOUR } from '#shared/utils/skills-policy'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export const SKILL_BURST_RATE_LIMIT_PERIOD_SECONDS = 60
export const SKILL_RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS = 60

const RATE_LIMIT_KEY_PREFIX = 'skills-import-rate-limit'
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60

interface RateLimitBinding {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

function tooManyRequests(
  event: RequestEvent,
  retryAfterSeconds: number,
  why: string,
) {
  event.res.headers.set('Retry-After', String(retryAfterSeconds))

  return createError({
    message: 'Too many skill imports',
    status: 429,
    why,
    fix: 'Try again later',
  })
}

/**
 * A short burst limit (the Workers Rate Limiting binding `SKILLS_RATE_LIMITER`,
 * 3 per 60 s per user, shared by preview, paste and commit). The binding is
 * per location and eventually consistent, so it is a flood guard, not exact
 * accounting; like the consents limiter it is skipped when the binding is
 * missing (unit tests, self-hosts) and when the binding itself throws.
 */
export async function enforceSkillBurstLimit(
  event: RequestEvent,
  userId: number,
): Promise<void> {
  const limiter = env.SKILLS_RATE_LIMITER as RateLimitBinding | undefined
  const logger = useRequestLogger(event)

  if (!limiter) {
    logger.set({ attributes: { skills: { burstLimit: 'binding-unavailable' } } })

    return
  }

  let success: boolean

  try {
    success = (await limiter.limit({ key: `skills-import:${userId}` })).success
  } catch (exception) {
    logger.set({
      attributes: {
        skills: {
          burstLimit: 'limiter-error',
          burstLimitError: exceptionMessage(exception),
        },
      },
    })

    return
  }

  if (!success) {
    throw tooManyRequests(
      event,
      SKILL_BURST_RATE_LIMIT_PERIOD_SECONDS,
      'Too many skill imports in a short time',
    )
  }
}

/**
 * Ten imports an hour per user, counted where the CPU and R2 work starts:
 * the preview and the paste route. The KV counter is not atomic, which is why
 * the burst limit sits in front of it, and it fails closed: when KV cannot
 * be read or written the request is answered 429 with `Retry-After: 60`
 * instead of being let through uncounted.
 */
export async function enforceSkillImportRateLimit(
  event: RequestEvent,
  userId: number,
): Promise<void> {
  await enforceSkillBurstLimit(event, userId)

  let result: { allowed: boolean, retryAfter: number | null }

  try {
    const storage = createAuthRateLimitStorage(useKV(), RATE_LIMIT_KEY_PREFIX)

    result = await storage.consume(String(userId), {
      window: RATE_LIMIT_WINDOW_SECONDS,
      max: SKILL_IMPORTS_PER_HOUR,
    })
  } catch (exception) {
    useRequestLogger(event).set({
      attributes: {
        skills: {
          rateLimit: {
            failedClosed: true,
            error: exceptionMessage(exception),
          },
        },
      },
    })

    throw tooManyRequests(
      event,
      SKILL_RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS,
      'The import limit could not be checked',
    )
  }

  if (result.allowed) {
    return
  }

  throw tooManyRequests(
    event,
    result.retryAfter ?? SKILL_RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS,
    `At most ${SKILL_IMPORTS_PER_HOUR} skills can be imported per hour`,
  )
}
