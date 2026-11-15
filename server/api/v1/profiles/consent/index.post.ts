import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import {
  CURRENT_CONSENT_VERSION,
  recordLegalConsent,
  throwConsentVersionUnavailable,
  toLegalConsentState,
} from '~~/server/utils/legal/consent'
import {
  loadApprovedConsentVersion,
  resolveEffectiveConsentVersion,
} from '~~/server/utils/legal/consent-version'
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
    version: z.string().min(1).max(32),
    acceptTerms: z.literal(true),
    confirmAge: z.literal(true),
    sensitiveContentConsent: z.literal(true),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Both boxes must be ticked',
      status: 400,
      why: body.error.message,
      fix: 'Confirm that you are 18 or over and accept the Terms of Use, and give your explicit consent.',
    })
  }

  const approvedVersion = await loadApprovedConsentVersion()

  if (approvedVersion === null) {
    throwConsentVersionUnavailable()
  }

  const effectiveVersion = resolveEffectiveConsentVersion(
    CURRENT_CONSENT_VERSION,
    approvedVersion,
  )

  if (body.data.version !== effectiveVersion) {
    throw createError({
      message: 'The consent text has changed',
      status: 409,
      why: `You agreed to version ${body.data.version}, the current version is ${effectiveVersion}.`,
      fix: 'Reload the page and read the updated text before you agree.',
    })
  }

  const userId = parseInt(session.user.id)
  const record = await recordLegalConsent(
    userId,
    useDb(),
    new Date(),
    effectiveVersion,
  )

  logger.set({
    userId,
    attributes: {
      legalConsent: {
        action: 'granted',
        version: effectiveVersion,
      },
    },
  })

  return toLegalConsentState(record)
})
