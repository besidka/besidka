import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
import { getRequestHeader } from 'nuxt/server'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { resolveRateLimitKey } from '~~/server/utils/consents-rate-limit'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { useRequestLogger } from '~~/server/utils/logging/request-logger'

export const ARTIFACT_REPORT_RATE_LIMIT = { window: 3600, max: 5 }
export const ARTIFACT_REPORT_RECEIPT_LIMIT = { window: 86400, max: 3 }

const ARTIFACT_REPORT_RATE_LIMIT_KEY_PREFIX = 'artifact-report:rate-limit'
const ARTIFACT_REPORT_RECEIPT_KEY_PREFIX = 'artifact-report:receipt'
const RETRY_AFTER_ON_STORAGE_ERROR_SECONDS = 1

type RequestLogger = ReturnType<typeof useRequestLogger>

/**
 * HMAC-SHA256 (hex) of a rate-limit identifier keyed with the existing
 * `encryptionKey`, so KV never holds a client IP or an email address, and
 * a KV read alone cannot be reversed by hashing a list of candidates.
 * Throws when the key is not configured.
 */
export async function hashArtifactReportLimitKey(
  value: string,
): Promise<string> {
  const secret = String(useRuntimeConfig().encryptionKey ?? '')

  if (!secret) {
    throw createError({
      message: 'Missing rate limit key secret',
      status: 500,
      why: 'NUXT_ENCRYPTION_KEY is not configured',
    })
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(value),
  )

  return Array.from(new Uint8Array(signature), (byte) => {
    return byte.toString(16).padStart(2, '0')
  }).join('')
}

async function resolveReporterKey(
  event: RequestEvent,
  userId: number | null,
): Promise<string | null> {
  if (userId !== null) {
    return `user:${userId}`
  }

  const clientIp = getRequestHeader(event, 'cf-connecting-ip')

  if (!clientIp) {
    return null
  }

  return `ip:${await hashArtifactReportLimitKey(resolveRateLimitKey(clientIp))}`
}

function throwReportRateLimited(
  event: RequestEvent,
  retryAfter: number | null,
  why: string,
): never {
  if (retryAfter !== null) {
    event.res.headers.set('Retry-After', String(retryAfter))
  }

  throw createError({
    message: 'Too many reports',
    status: 429,
    why,
    fix: 'Wait before sending another report',
  })
}

/**
 * KV limiter for artifact reports: 5 per hour per signed-in user, otherwise
 * per client IP (IPv6 by /64), keyed by an HMAC of the address, never the
 * address itself. Uses the same KV storage as the knowledge and gateway
 * catalog limiters, so it needs no extra Workers binding. Fails open, with
 * a note on the logger, when neither a user nor an IP is known; a KV error
 * answers 429 with `Retry-After: 1`.
 */
export async function enforceArtifactReportRateLimit(
  event: RequestEvent,
  userId: number | null,
  logger: RequestLogger,
): Promise<void> {
  const key = await resolveReporterKey(event, userId)

  if (!key) {
    logger.set({
      attributes: {
        artifacts: { reportRateLimit: { skipped: 'no-client-key' } },
      },
    })

    return
  }

  const storage = createAuthRateLimitStorage(
    useKV(),
    ARTIFACT_REPORT_RATE_LIMIT_KEY_PREFIX,
  )
  let result: Awaited<ReturnType<typeof storage.consume>>

  try {
    result = await storage.consume(key, ARTIFACT_REPORT_RATE_LIMIT)
  } catch (exception) {
    logger.set({
      attributes: {
        artifacts: {
          reportRateLimit: { error: exceptionMessage(exception) },
        },
      },
    })

    throwReportRateLimited(
      event,
      RETRY_AFTER_ON_STORAGE_ERROR_SECONDS,
      'Reports came too close together',
    )
  }

  if (result.allowed) {
    return
  }

  throwReportRateLimited(
    event,
    result.retryAfter,
    'Too many reports from this client in the last hour',
  )
}

/**
 * Takes one receipt from the per-recipient cap: 3 receipts per address per
 * 24 hours, keyed by an HMAC of the lowercased address. Returns false over
 * the cap and when KV or the key secret fails, so the report is still
 * saved and only the receipt is skipped.
 */
export async function consumeArtifactReportReceiptSlot(
  address: string,
  logger: RequestLogger,
): Promise<boolean> {
  try {
    const storage = createAuthRateLimitStorage(
      useKV(),
      ARTIFACT_REPORT_RECEIPT_KEY_PREFIX,
    )
    const key = await hashArtifactReportLimitKey(address.trim().toLowerCase())
    const result = await storage.consume(key, ARTIFACT_REPORT_RECEIPT_LIMIT)

    if (!result.allowed) {
      logger.set({
        attributes: { artifacts: { receiptSkipped: 'recipient-cap' } },
      })
    }

    return result.allowed
  } catch (exception) {
    logger.set({
      attributes: {
        artifacts: {
          receiptSkipped: 'cap-error',
          receiptCapError: exceptionMessage(exception),
        },
      },
    })

    return false
  }
}
