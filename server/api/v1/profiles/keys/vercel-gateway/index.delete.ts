import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

const RATE_LIMIT_RULE = { window: 60, max: 10 }
const RATE_LIMIT_KEY_PREFIX = 'keys-rate-limit:vercel-gateway:delete'

export default defineEventHandler(async (event) => {
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

  await useDb()
    .delete(schema.keys)
    .where(and(
      eq(schema.keys.userId, parseInt(session.user.id)),
      eq(schema.keys.provider, 'vercel-gateway'),
    ))

  return setResponseStatus(event, 204, 'API key deleted successfully')
})
