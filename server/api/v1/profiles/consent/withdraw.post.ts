import { defineEventHandler } from 'nuxt/server'
import {
  toLegalConsentState,
  withdrawLegalConsent,
} from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

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
