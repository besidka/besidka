import { useLogger } from 'evlog'
import { createAuthMiddleware } from 'evlog/better-auth'
import type { BetterAuthInstance } from 'evlog/better-auth'
import type { AuthSession } from '~~/server/types/h3-context'

type Identify = ReturnType<typeof createAuthMiddleware>

let identify: Identify | undefined

function getIdentify(): Identify {
  if (identify) {
    return identify
  }

  identify = createAuthMiddleware(
    useServerAuth() as unknown as BetterAuthInstance,
    {
      // Skip session resolution on auth flows and high-traffic public paths.
      exclude: [
        '/api/auth/**',
        '/api/_evlog/**',
        '/api/_nuxt_icon/**',
        '/api/v1/stats*',
        '/api/v1/consents*',
        '/_nuxt/**',
        '/health',
      ],
      maskEmail: true,
      onIdentify: (_logger, session) => {
        useEvent().context.authSession = session as AuthSession
      },
      onAnonymous: (logger) => {
        logger.set({ anonymous: true })
      },
    },
  )

  return identify
}

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  await getIdentify()(logger, event.headers, event.path)
})
