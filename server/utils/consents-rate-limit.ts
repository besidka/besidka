import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { getRequestHeader } from 'nuxt/server'
// @ts-ignore
import { env } from 'cloudflare:workers'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type {
  useRequestLogger,
} from '~~/server/utils/logging/request-logger'

export const CONSENTS_RATE_LIMIT_PERIOD_SECONDS = 60

const MAX_RATE_LIMIT_KEY_LENGTH = 64
const IPV6_GROUP_PATTERN = /^[0-9a-f]{1,4}$/i
const IPV4_MAPPED_IPV6_PATTERN = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i

interface RateLimitBinding {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

function expandIpv6Groups(address: string): string[] | null {
  const halves = address.split('::')

  if (halves.length > 2) {
    return null
  }

  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves[1] ? halves[1].split(':') : []
  const hasCompression = halves.length === 2
  const missingGroups = 8 - head.length - tail.length

  if (hasCompression ? missingGroups < 1 : missingGroups !== 0) {
    return null
  }

  const groups = [...head, ...Array(missingGroups).fill('0'), ...tail]

  if (!groups.every(group => IPV6_GROUP_PATTERN.test(group))) {
    return null
  }

  return groups.map(group => Number.parseInt(group, 16).toString(16))
}

/**
 * Collapses an IPv6 address to its /64 prefix so a client that owns a whole
 * /64 cannot dodge the limit by rotating addresses. IPv4 and IPv4-mapped
 * IPv6 addresses are keyed as-is; anything unparseable is keyed verbatim,
 * truncated.
 */
export function resolveRateLimitKey(clientIp: string): string {
  const address = clientIp.trim().replace(/^\[|\]$/g, '').split('%')[0] ?? ''

  if (!address.includes(':')) {
    return address.slice(0, MAX_RATE_LIMIT_KEY_LENGTH)
  }

  const mappedIpv4 = address.match(IPV4_MAPPED_IPV6_PATTERN)

  if (mappedIpv4) {
    return mappedIpv4[1]!
  }

  const groups = expandIpv6Groups(address)

  if (!groups) {
    return address.slice(0, MAX_RATE_LIMIT_KEY_LENGTH)
  }

  return `${groups.slice(0, 4).join(':')}::/64`
}

/**
 * Throttles `POST /api/v1/consents` with the Workers Rate Limiting binding
 * (`CONSENTS_RATE_LIMITER`, 60 requests per 60 s), keyed by client IP (IPv6 by
 * /64). The binding counts per Cloudflare location and is eventually
 * consistent, so it is a flood guard rather than exact accounting. A KV
 * counter cannot do this job: KV allows about one write per second to a key
 * and the read-then-write is not atomic.
 *
 * Fails open (and records why on the logger) when the binding is missing, as
 * in unit tests and non-Cloudflare self-hosts, when the client IP is unknown,
 * or when the binding throws.
 */
export async function enforceConsentsRateLimit(
  event: RequestEvent,
  logger: ReturnType<typeof useRequestLogger>,
): Promise<void> {
  const clientIp = getRequestHeader(event, 'cf-connecting-ip')

  if (!clientIp) {
    logger.set({ consentRateLimit: { skipped: 'no-client-ip' } })

    return
  }

  const { CONSENTS_RATE_LIMITER } = env
  const limiter = CONSENTS_RATE_LIMITER as RateLimitBinding | undefined

  if (!limiter) {
    logger.set({ consentRateLimit: { skipped: 'binding-unavailable' } })

    return
  }

  let success: boolean

  try {
    const outcome = await limiter.limit({
      key: resolveRateLimitKey(clientIp),
    })

    success = outcome.success
  } catch (exception) {
    logger.set({
      consentRateLimit: { skipped: 'limiter-error' },
      attributes: {
        consentRateLimit: { error: exceptionMessage(exception) },
      },
    })

    return
  }

  if (success) {
    return
  }

  event.res.headers.set(
    'Retry-After',
    String(CONSENTS_RATE_LIMIT_PERIOD_SECONDS),
  )

  throw createError({
    message: 'Too many consent receipts',
    status: 429,
    why: 'Consent receipt rate limit exceeded for this client',
    fix: 'Wait a minute before submitting another receipt',
  })
}
