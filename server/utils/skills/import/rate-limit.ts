import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
// @ts-ignore
import { env } from 'cloudflare:workers'
import {
  SKILL_IMPORTS_PER_HOUR,
  SKILL_SAVES_PER_HOUR,
} from '#shared/utils/skills-policy'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export const SKILL_BURST_RATE_LIMIT_PERIOD_SECONDS = 60
export const SKILL_RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS = 60

const RATE_LIMIT_KEY_PREFIX = 'skills-import-rate-limit'
const SAVE_RATE_LIMIT_KEY_PREFIX = 'skills-save-rate-limit'
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60

interface RateLimitBinding {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

interface HourlyLimit {
  keyPrefix: string
  max: number
  message: string
  unavailableWhy: string
  exceededWhy: string
}

function tooManyRequests(
  event: RequestEvent,
  retryAfterSeconds: number,
  why: string,
  message = 'Too many skill imports',
) {
  event.res.headers.set('Retry-After', String(retryAfterSeconds))

  return createError({
    message,
    status: 429,
    why,
    fix: 'Try again later',
  })
}

/**
 * A short burst limit (the Workers Rate Limiting binding `SKILLS_RATE_LIMITER`,
 * 10 per 60 s per user, shared by preview, paste and commit). The binding is
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
 * An hourly per-user count, counted where the work starts. The KV counter is
 * not atomic, and it fails closed: when KV cannot be read or written the
 * request is answered 429 with `Retry-After: 60` instead of being let
 * through uncounted.
 */
async function consumeHourlyLimit(
  event: RequestEvent,
  userId: number,
  limit: HourlyLimit,
): Promise<void> {
  let result: { allowed: boolean, retryAfter: number | null }

  try {
    const storage = createAuthRateLimitStorage(useKV(), limit.keyPrefix)

    result = await storage.consume(String(userId), {
      window: RATE_LIMIT_WINDOW_SECONDS,
      max: limit.max,
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
      limit.unavailableWhy,
      limit.message,
    )
  }

  if (result.allowed) {
    return
  }

  throw tooManyRequests(
    event,
    result.retryAfter ?? SKILL_RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS,
    limit.exceededWhy,
    limit.message,
  )
}

/**
 * Ten imports an hour per user, counted where the CPU and R2 work starts:
 * the preview and the paste route, with the burst limit in front.
 */
export async function enforceSkillImportRateLimit(
  event: RequestEvent,
  userId: number,
): Promise<void> {
  await enforceSkillBurstLimit(event, userId)

  await consumeHourlyLimit(event, userId, {
    keyPrefix: RATE_LIMIT_KEY_PREFIX,
    max: SKILL_IMPORTS_PER_HOUR,
    message: 'Too many skill imports',
    unavailableWhy: 'The import limit could not be checked',
    exceededWhy: `At most ${SKILL_IMPORTS_PER_HOUR} skills can be imported per hour`,
  })
}

/**
 * 120 saves an hour per user, shared by creating a skill, saving files and
 * restoring a version. There is no burst limit in front: the burst limiter
 * is the import limiter (10 per minute), which an editor would hit.
 */
export async function enforceSkillSaveRateLimit(
  event: RequestEvent,
  userId: number,
): Promise<void> {
  await consumeHourlyLimit(event, userId, {
    keyPrefix: SAVE_RATE_LIMIT_KEY_PREFIX,
    max: SKILL_SAVES_PER_HOUR,
    message: 'Too many skill saves',
    unavailableWhy: 'The save limit could not be checked',
    exceededWhy: `At most ${SKILL_SAVES_PER_HOUR} skill saves are allowed per hour`,
  })
}
