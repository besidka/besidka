import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
import {
  DOCUMENT_FILE_RATE_LIMIT_PER_MINUTE,
  DOCUMENT_RENDER_RATE_LIMIT_PER_MINUTE,
} from '#shared/utils/documents'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export type DocumentRateLimitKind = 'file' | 'render'

const RATE_LIMIT_WINDOW_SECONDS = 60

const RATE_LIMIT_RULES: Record<
  DocumentRateLimitKind,
  { keyPrefix: string, max: number }
> = {
  file: {
    keyPrefix: 'documents-file-rate-limit',
    max: DOCUMENT_FILE_RATE_LIMIT_PER_MINUTE,
  },
  render: {
    keyPrefix: 'documents-render-rate-limit',
    max: DOCUMENT_RENDER_RATE_LIMIT_PER_MINUTE,
  },
}

async function consumeRateLimit(
  userId: number,
  rule: { keyPrefix: string, max: number },
) {
  const storage = createAuthRateLimitStorage(useKV(), rule.keyPrefix)

  return await storage.consume(String(userId), {
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: rule.max,
  })
}

/**
 * Per-user, per-minute limit on the two document routes that do real work.
 * Each kind has its own KV bucket, so a render fallback never eats into the
 * upload budget. KV allows one write per second per key, so several uploads
 * of one turn can fail the counter write; that failure fails open (the
 * request is allowed and the error is logged) instead of becoming a 500,
 * while a stored count over the limit still answers 429.
 */
export async function enforceDocumentRateLimit(
  event: RequestEvent,
  userId: number,
  kind: DocumentRateLimitKind,
): Promise<void> {
  const rule = RATE_LIMIT_RULES[kind]
  let result: Awaited<ReturnType<typeof consumeRateLimit>>

  try {
    result = await consumeRateLimit(userId, rule)
  } catch (exception) {
    useRequestLogger(event).set({
      attributes: {
        documents: {
          rateLimit: { kind, failedOpen: true },
          rateLimitError: exceptionMessage(exception),
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
    message: 'Too many requests',
    status: 429,
    why: 'Document rate limit exceeded',
    fix: 'Wait a moment before retrying',
  })
}
