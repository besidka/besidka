import { and, eq, isNull } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import {
  defineEventHandler,
  readValidatedBody,
} from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const RATE_LIMIT_RULE = { window: 60, max: 10 }
const RATE_LIMIT_KEY_PREFIX = 'keys-rate-limit:google:paid-tier'

/**
 * Records or withdraws the user's statement that their Gemini key is on a
 * Google Cloud project with billing enabled (`keys.paid_tier_confirmed_at`),
 * the condition under which a chat that holds Google data may use Gemini.
 * Confirming again keeps the first time; replacing the key clears it.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const body = await readValidatedBody(event, z.object({
    confirmed: z.boolean(),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)

  await enforceKeysRateLimit(
    event,
    session.user.id,
    RATE_LIMIT_KEY_PREFIX,
    RATE_LIMIT_RULE,
  )

  const db = useDb()
  const ownKey = and(
    eq(schema.keys.userId, userId),
    eq(schema.keys.provider, 'google'),
  )
  const existingKey = await db.query.keys.findFirst({
    where: { userId, provider: 'google' },
    columns: { provider: true },
  })

  if (!existingKey) {
    throw createError({
      message: 'Gemini API key not found',
      status: 404,
      why: 'No Gemini API key is saved for this account.',
      fix: 'Save a Gemini API key first.',
    })
  }

  if (body.data.confirmed) {
    await db.update(schema.keys)
      .set({ paidTierConfirmedAt: new Date() })
      .where(and(ownKey, isNull(schema.keys.paidTierConfirmedAt)))
  } else {
    await db.update(schema.keys)
      .set({ paidTierConfirmedAt: null })
      .where(ownKey)
  }

  logger.set({
    userId,
    attributes: {
      googleDataGuard: { paidTierConfirmed: body.data.confirmed },
    },
  })

  return { paidTierConfirmed: body.data.confirmed }
})
