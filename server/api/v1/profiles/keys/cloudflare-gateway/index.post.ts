import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

const RATE_LIMIT_RULE = { window: 60, max: 10 }
const RATE_LIMIT_KEY_PREFIX = 'keys-rate-limit:cloudflare-gateway:post'

const CLOUDFLARE_ID_MAX_LENGTH = 128
const CLOUDFLARE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const CLOUDFLARE_API_KEY_MAX_LENGTH = 2048
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1F\x7F]/

const cloudflareIdSchema = z.string()
  .nonempty()
  .max(CLOUDFLARE_ID_MAX_LENGTH)
  .regex(CLOUDFLARE_ID_PATTERN)

const cloudflareApiKeySchema = z.string()
  .nonempty()
  .max(CLOUDFLARE_API_KEY_MAX_LENGTH)
  .refine(value => !CONTROL_CHARACTER_PATTERN.test(value))

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    accountId: cloudflareIdSchema,
    gatewayId: cloudflareIdSchema.optional(),
    apiKey: cloudflareApiKeySchema,
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
      provider: 'cloudflare-gateway',
    },
  })

  const apiKey = await useEncryptText(JSON.stringify({
    accountId: body.data.accountId,
    gatewayId: body.data.gatewayId,
    apiKey: body.data.apiKey,
  }))

  if (existingKey) {
    await db.update(schema.keys).set({
      apiKey,
    }).where(and(
      eq(schema.keys.userId, parseInt(session.user.id)),
      eq(schema.keys.provider, 'cloudflare-gateway'),
    ))

    return setResponseStatus(event, 204, 'Key updated successfully')
  }

  await db.insert(schema.keys).values({
    userId: parseInt(session.user.id),
    provider: 'cloudflare-gateway',
    apiKey,
  })

  return setResponseStatus(event, 201, 'Key created successfully')
})
