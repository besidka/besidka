import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { transferConsentProviderIds } from '#shared/utils/legal-consent'
import {
  recordProviderTransferConsent,
  toLegalConsentState,
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
    transferConsent: z.literal(true),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'The transfer consent box must be ticked',
      status: 400,
      why: body.error.message,
      fix: 'Tick the box to consent to the transfer, or cancel.',
    })
  }

  const userId = parseInt(session.user.id)
  const record = await recordProviderTransferConsent(
    userId,
    body.data.provider,
  )

  logger.set({
    userId,
    attributes: {
      legalConsent: {
        action: 'transfer-granted',
        provider: body.data.provider,
      },
    },
  })

  return toLegalConsentState(record)
})
