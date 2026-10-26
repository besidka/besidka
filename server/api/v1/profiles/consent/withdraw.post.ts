import { defineEventHandler } from 'nuxt/server'
import {
  toLegalConsentState,
  withdrawLegalConsent,
} from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { enforceMemoryRateLimit } from '~~/server/utils/memory/rate-limit'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  await enforceMemoryRateLimit(
    'legal-consent',
    parseInt(session.user.id),
    event,
  )

  const userId = parseInt(session.user.id)
  const record = await withdrawLegalConsent(userId)

  logger.set({
    userId,
    attributes: {
      legalConsent: {
        action: 'withdrawn',
      },
    },
  })

  return toLegalConsentState(record)
})
