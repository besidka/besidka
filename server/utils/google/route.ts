import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { getRequestHeader } from 'nuxt/server'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { assertConnectorWriteRequest } from '~~/server/utils/connectors/route'
import { evaluateFeatureForEvent } from '~~/server/utils/features/context'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export const GOOGLE_FEATURE_FLAG = 'google.drive'
export const GOOGLE_WRITES_PER_MINUTE = 10
export const GOOGLE_READS_PER_MINUTE = 60
export const GOOGLE_CALLBACK_FAILURE_KEY_PREFIX = 'google:callback-failures:'

const WRITE_RATE_LIMIT_PREFIX = 'google-rate-limit'
const READ_RATE_LIMIT_PREFIX = 'google-read-rate-limit'
const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS = 60

export type GoogleRateLimitBucket = 'write' | 'read' | 'none'

function tooManyRequests(
  event: RequestEvent,
  retryAfterSeconds: number,
  max: number,
) {
  event.res.headers.set('Retry-After', String(retryAfterSeconds))

  return createError({
    message: 'Too many Google requests',
    status: 429,
    why: `At most ${max} Google connection requests are allowed per minute`,
    fix: 'Wait a moment before retrying',
  })
}

/**
 * A per-user KV counter, read-then-write and so a flood guard rather than
 * exact accounting. Fails closed: when KV cannot count, the request is
 * refused with `Retry-After: 60`.
 */
async function enforceGoogleRateLimit(
  event: RequestEvent,
  userId: number,
  bucket: Exclude<GoogleRateLimitBucket, 'none'>,
): Promise<void> {
  const max = bucket === 'write'
    ? GOOGLE_WRITES_PER_MINUTE
    : GOOGLE_READS_PER_MINUTE
  const prefix = bucket === 'write'
    ? WRITE_RATE_LIMIT_PREFIX
    : READ_RATE_LIMIT_PREFIX
  let result: { allowed: boolean, retryAfter: number | null }

  try {
    result = await createAuthRateLimitStorage(useKV(), prefix).consume(
      String(userId),
      { window: RATE_LIMIT_WINDOW_SECONDS, max },
    )
  } catch {
    useRequestLogger(event).set({
      attributes: { google: { rateLimit: 'unavailable' } },
    })

    throw tooManyRequests(event, RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS, max)
  }

  if (!result.allowed) {
    throw tooManyRequests(
      event,
      result.retryAfter ?? RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS,
      max,
    )
  }
}

const CROSS_SITE_FETCH_SITES: ReadonlySet<string> = new Set([
  'cross-site',
  'same-site',
])

function assertNotCrossSiteRead(event: RequestEvent): void {
  const fetchSite = getRequestHeader(event, 'sec-fetch-site')

  if (fetchSite && CROSS_SITE_FETCH_SITES.has(fetchSite)) {
    throw createError({
      message: 'Forbidden',
      status: 403,
      why: 'The request did not come from the same origin',
      fix: 'Open the page in the Besidka app',
    })
  }
}

/**
 * The gate of every Google connection route, in this order: the same-origin
 * guard (the full write guard for POST routes; for a GET only a refusal of
 * a cross-site `Sec-Fetch-Site`, because a same-origin GET sends no
 * `Origin`), a session, the `google.drive` flag active for this user
 * (enabled and opted in) unless `feature: false`, then the per-user rate
 * limit. Disconnect and the status read pass `feature: false`: a user who
 * is connected must always be able to see and end the connection, even
 * after the flag is turned off or they opt out. Returns the user id.
 */
export async function requireGoogleAccess(
  event: RequestEvent,
  options: {
    write: boolean
    rateLimit: GoogleRateLimitBucket
    feature?: boolean
  },
): Promise<number> {
  if (options.write) {
    assertConnectorWriteRequest(event)
  } else {
    assertNotCrossSiteRead(event)
  }

  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  if (options.feature !== false) {
    await requireFeature(event, GOOGLE_FEATURE_FLAG)
  }

  const userId = parseInt(session.user.id)

  if (options.rateLimit !== 'none') {
    await enforceGoogleRateLimit(event, userId, options.rateLimit)
  }

  useRequestLogger(event).set({ userId })

  return userId
}

export async function isGoogleFeatureActive(
  event: RequestEvent,
): Promise<boolean> {
  try {
    return (await evaluateFeatureForEvent(event, GOOGLE_FEATURE_FLAG)).active
  } catch {
    return false
  }
}

/**
 * The failed-callback budget key of a client: a SHA-256 of its IP, so KV
 * never holds the address. Separate from the connectors budget.
 */
export async function googleCallbackClientKey(
  ip: string | null | undefined,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(ip || 'unknown'),
  )

  return `${GOOGLE_CALLBACK_FAILURE_KEY_PREFIX}${Buffer.from(digest).toString('base64url')}`
}
