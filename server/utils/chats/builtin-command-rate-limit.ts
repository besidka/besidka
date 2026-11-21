import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'

export const BUILTIN_COMMAND_RATE_LIMIT = {
  window: 60,
  max: 30,
} as const

const BUILTIN_COMMAND_RATE_LIMIT_KEY_PREFIX = 'builtin-command-rate-limit'

/**
 * The one per-user KV limiter of the built-in command path (`/cost`,
 * `/stats`, `/debug`) and of the support-info route behind `/debug`: 30 runs
 * a minute. A command spends no model call, but it reads D1 and writes two
 * messages, so a loop of them must not turn into a read flood. Answers 429
 * with a `Retry-After` header. A KV failure refuses the run instead of
 * letting an uncounted one through.
 */
export async function enforceBuiltinCommandRateLimit(
  userId: number,
  event?: Pick<RequestEvent, 'res'>,
): Promise<void> {
  const storage = createAuthRateLimitStorage(
    useKV(),
    BUILTIN_COMMAND_RATE_LIMIT_KEY_PREFIX,
    { denyOnKvError: true },
  )
  const result = await storage.consume(String(userId), {
    window: BUILTIN_COMMAND_RATE_LIMIT.window,
    max: BUILTIN_COMMAND_RATE_LIMIT.max,
  })

  if (result.allowed) {
    return
  }

  if (event && result.retryAfter !== null) {
    event.res.headers.set('Retry-After', String(result.retryAfter))
  }

  throw createError({
    message: 'Too many commands in a short time. Try again in a minute.',
    status: 429,
    why: 'Built-in commands are limited to 30 a minute per account',
    fix: 'Wait a minute, then run the command again',
  })
}
