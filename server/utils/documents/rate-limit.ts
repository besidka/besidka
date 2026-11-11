import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
import {
  DOCUMENT_FILE_RATE_LIMIT_PER_MINUTE,
  DOCUMENT_RENDER_RATE_LIMIT_PER_MINUTE,
} from '#shared/utils/documents'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'

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

/**
 * Per-user, per-minute limit on the two document routes that do real work.
 * Each kind has its own KV bucket, so a render fallback never eats into the
 * upload budget.
 */
export async function enforceDocumentRateLimit(
  event: RequestEvent,
  userId: number,
  kind: DocumentRateLimitKind,
): Promise<void> {
  const rule = RATE_LIMIT_RULES[kind]
  const kv = useKV()
  const storage = createAuthRateLimitStorage(kv, rule.keyPrefix)
  const result = await storage.consume(String(userId), {
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: rule.max,
  })

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
