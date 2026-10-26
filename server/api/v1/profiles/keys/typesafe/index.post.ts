import { createError } from 'evlog'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  defineEventHandler,
  readValidatedBody,
  setResponseStatus,
} from 'nuxt/server'
import { recordKeyEvent } from '~~/server/utils/analytics/key-events'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { verifyMemoryJevApiKey } from '~~/server/utils/memory/jev-check'

const RATE_LIMIT_RULE = { window: 60, max: 10 }
const RATE_LIMIT_KEY_PREFIX = 'keys-rate-limit:typesafe:post'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    apiKey: z.string().nonempty(),
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

  await enforceKeysRateLimit(
    event,
    session.user.id,
    RATE_LIMIT_KEY_PREFIX,
    RATE_LIMIT_RULE,
  )

  const verification = await verifyMemoryJevApiKey(body.data.apiKey)

  useRequestLogger(event).set({
    attributes: { keys: { verification } },
  })

  if (verification === 'unauthorized') {
    throw createError({
      message: 'TypeSafe AI rejected this API key',
      status: 400,
      why: 'TypeSafe AI refused the key (401 or 403) when Besidka checked '
        + 'it, so it is wrong, revoked or from another account.',
      fix: 'Copy the key again from the TypeSafe AI console '
        + '(console.typesafe.ai/keys) and paste it here.',
    })
  }

  const db = useDb()

  const existingKey = await db.query.keys.findFirst({
    where: {
      userId: parseInt(session.user.id),
      provider: 'typesafe',
    },
  })

  const apiKey = await useEncryptText(body.data.apiKey)

  if (existingKey) {
    await db.update(schema.keys).set({
      apiKey,
    }).where(and(
      eq(schema.keys.userId, parseInt(session.user.id)),
      eq(schema.keys.provider, 'typesafe'),
    ))

    recordKeyEvent('typesafe', 'updated')

    return setResponseStatus(event, 204, 'Key updated successfully')
  }

  await db.insert(schema.keys).values({
    userId: parseInt(session.user.id),
    provider: 'typesafe',
    apiKey,
  })

  recordKeyEvent('typesafe', 'created')

  return setResponseStatus(event, 201, 'Key created successfully')
})
