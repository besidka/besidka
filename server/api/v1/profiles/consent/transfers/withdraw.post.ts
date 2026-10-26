import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { transferConsentProviderIds } from '#shared/utils/legal-consent'
import {
  toLegalConsentState,
  withdrawProviderTransferConsent,
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

  const body = await readValidatedBody(event, z.object({
    provider: z.enum(transferConsentProviderIds),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const userId = parseInt(session.user.id)
  const record = await withdrawProviderTransferConsent(
    userId,
    body.data.provider,
  )

  logger.set({
    userId,
    attributes: {
      legalConsent: {
        action: 'transfer-withdrawn',
        provider: body.data.provider,
      },
    },
  })

  return toLegalConsentState(record)
})
