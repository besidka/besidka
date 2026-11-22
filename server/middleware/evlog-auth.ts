import { createAuthMiddleware } from 'evlog/better-auth'
import type { BetterAuthInstance } from 'evlog/better-auth'
import type { AuthSession } from '~~/server/types/h3-context'
import { defineEventHandler } from 'nuxt/server'
import { retryOnEndedRequestPromise } from '~~/server/utils/auth-instance'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const SKIPPED_SESSION_PATHS = [
  '/api/auth/**',
  '/api/_evlog/**',
  '/api/_nuxt_icon/**',
  '/api/v1/stats*',
  '/api/v1/consents*',
  '/api/v1/internal/mail-alert',
  '/mcp',
  '/.well-known/**',
  '/_nuxt/**',
  '/health',
]

const sessionResolver = {
  api: {
    getSession: (context: { headers: Headers }) => {
      return retryOnEndedRequestPromise(() => {
        return useServerAuth().api.getSession(context)
      }, () => dropServerAuth())
    },
  },
} as unknown as BetterAuthInstance

const identify = createAuthMiddleware(sessionResolver, {
  exclude: SKIPPED_SESSION_PATHS,
  maskEmail: true,
  onIdentify: (_logger, session) => {
    useEvent().context.authSession = session as AuthSession
  },
  onAnonymous: (logger) => {
    logger.set({ anonymous: true })
  },
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  const { pathname, search } = event.url

  await identify(logger, event.req.headers, `${pathname}${search}`)
})
