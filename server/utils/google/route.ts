import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { GOOGLE_FILE_DOWNLOADS_PER_HOUR } from '#shared/utils/google-file-download'
import { GOOGLE_TOOL_PERMISSION_WRITES_PER_MINUTE } from '#shared/utils/google-tool-catalog'
import { getRequestHeader } from 'nuxt/server'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { assertConnectorWriteRequest } from '~~/server/utils/connectors/route'
import { evaluateFeatureForEvent } from '~~/server/utils/features/context'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export const GOOGLE_FEATURE_FLAG = 'google.drive'
export const GOOGLE_WRITES_PER_MINUTE = 10
export const GOOGLE_READS_PER_MINUTE = 60
export const GOOGLE_PICKER_TOKENS_PER_MINUTE = 30
export const GOOGLE_DRIVE_IMPORTS_PER_MINUTE = 10
export const GOOGLE_DRIVE_SAVES_PER_MINUTE = 10
export const GOOGLE_DRIVE_LINKS_PER_MINUTE = 20
export const GOOGLE_CALLBACK_FAILURE_KEY_PREFIX = 'google:callback-failures:'

const RATE_LIMIT_WINDOW_SECONDS = 60
const HOUR_RATE_LIMIT_WINDOW_SECONDS = 60 * 60
const RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS = 60

export type GoogleRateLimitBucket
  = | 'write'
    | 'read'
    | 'picker'
    | 'import'
    | 'link'
    | 'save'
    | 'download'
    | 'permission'
    | 'chat-service'
    | 'none'

const RATE_LIMIT_BUCKETS: Readonly<Record<
  Exclude<GoogleRateLimitBucket, 'none'>,
  { prefix: string, max: number, windowSeconds?: number }
>> = {
  'write': {
    prefix: 'google-rate-limit',
    max: GOOGLE_WRITES_PER_MINUTE,
  },
  'read': {
    prefix: 'google-read-rate-limit',
    max: GOOGLE_READS_PER_MINUTE,
  },
  'picker': {
    prefix: 'google-picker-rate-limit',
    max: GOOGLE_PICKER_TOKENS_PER_MINUTE,
  },
  'import': {
    prefix: 'google-drive-import-rate-limit',
    max: GOOGLE_DRIVE_IMPORTS_PER_MINUTE,
  },
  'link': {
    prefix: 'google-drive-link-rate-limit',
    max: GOOGLE_DRIVE_LINKS_PER_MINUTE,
  },
  'permission': {
    prefix: 'google-tool-permission-rate-limit',
    max: GOOGLE_TOOL_PERMISSION_WRITES_PER_MINUTE,
  },
  'chat-service': {
    prefix: 'google-chat-service-rate-limit',
    max: GOOGLE_TOOL_PERMISSION_WRITES_PER_MINUTE,
  },
  'save': {
    prefix: 'google-drive-save-rate-limit',
    max: GOOGLE_DRIVE_SAVES_PER_MINUTE,
  },
  'download': {
    prefix: 'google-file-download-rate-limit',
    max: GOOGLE_FILE_DOWNLOADS_PER_HOUR,
    windowSeconds: HOUR_RATE_LIMIT_WINDOW_SECONDS,
  },
}

function tooManyRequests(
  event: RequestEvent,
  retryAfterSeconds: number,
  max: number,
  windowSeconds: number = RATE_LIMIT_WINDOW_SECONDS,
) {
  event.res.headers.set('Retry-After', String(retryAfterSeconds))

  const isHourly = windowSeconds === HOUR_RATE_LIMIT_WINDOW_SECONDS

  return createError({
    message: 'Too many Google requests',
    status: 429,
    why: isHourly
      ? `At most ${max} Google downloads are allowed per hour`
      : `At most ${max} Google connection requests are allowed per minute`,
    fix: isHourly
      ? 'Try again later'
      : 'Wait a moment before retrying',
  })
}

/**
 * A per-user KV counter, read-then-write and so a flood guard rather than
 * exact accounting. Fails closed: when KV cannot count, the request is
 * refused with `Retry-After: 60`. With a `target` the counter key is the
 * user plus that target: KV takes about one write a second per key, so
 * routes whose callers change several things in a row (the per-chat Google
 * switches, the tool permissions) count each thing on its own key and two
 * quick changes of different things never share one.
 */
export async function enforceGoogleRateLimit(
  event: RequestEvent,
  userId: number,
  bucket: Exclude<GoogleRateLimitBucket, 'none'>,
  target?: string,
): Promise<void> {
  const { max, prefix, windowSeconds = RATE_LIMIT_WINDOW_SECONDS }
    = RATE_LIMIT_BUCKETS[bucket]
  let result: { allowed: boolean, retryAfter: number | null }

  try {
    result = await createAuthRateLimitStorage(useKV(), prefix).consume(
      target ? `${userId}:${target}` : String(userId),
      { window: windowSeconds, max },
    )
  } catch {
    useRequestLogger(event).set({
      attributes: { google: { rateLimit: 'unavailable' } },
    })

    throw tooManyRequests(
      event,
      RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS,
      max,
      windowSeconds,
    )
  }

  if (!result.allowed) {
    throw tooManyRequests(
      event,
      result.retryAfter ?? RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS,
      max,
      windowSeconds,
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
 * guard (the full write guard for POST and DELETE routes; for a GET only a
 * refusal of a cross-site `Sec-Fetch-Site`, because a same-origin GET sends
 * no `Origin`; none for `navigation: true`, the OAuth callbacks, which
 * Google reaches through a cross-site top-level redirect and which the
 * single-use state bound to the user protects instead), a session, the
 * `google.drive` flag active for this user (enabled and opted in) unless
 * `feature: false`, the `authorize` check when given (the bring-your-own
 * routes pass the admin and `google.byo` gate), then the per-user rate
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
    navigation?: boolean
    authorize?: (userId: number) => Promise<void>
  },
): Promise<number> {
  if (options.write) {
    assertConnectorWriteRequest(event)
  } else if (!options.navigation) {
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

  if (options.authorize) {
    await options.authorize(userId)
  }

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

export async function isConnectorsFeatureActive(
  event: RequestEvent,
): Promise<boolean> {
  try {
    return (await evaluateFeatureForEvent(event, 'connectors')).active
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
