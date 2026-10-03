import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

const RATE_LIMIT_RULE = { window: 60, max: 10 }
const RATE_LIMIT_KEY_PREFIX = 'keys-rate-limit:openrouter:post'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    apiKey: z.string().nonempty(),
  }).safeParse)

  if (body.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: body.error,
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

  const db = useDb()

  const existingKey = await db.query.keys.findFirst({
    where: {
      userId: parseInt(session.user.id),
      provider: 'openrouter',
    },
  })

  const apiKey = await useEncryptText(body.data.apiKey)

  if (existingKey) {
    await db.update(schema.keys).set({
      apiKey,
    }).where(and(
      eq(schema.keys.userId, parseInt(session.user.id)),
      eq(schema.keys.provider, 'openrouter'),
    ))

    return setResponseStatus(event, 204, 'Key updated successfully')
  }

  await db.insert(schema.keys).values({
    userId: parseInt(session.user.id),
    provider: 'openrouter',
    apiKey,
  })

  return setResponseStatus(event, 201, 'Key created successfully')
})
