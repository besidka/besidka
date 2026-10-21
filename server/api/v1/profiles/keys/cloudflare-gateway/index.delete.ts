import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import { recordKeyEvent } from '~~/server/utils/analytics/key-events'

const RATE_LIMIT_RULE = { window: 60, max: 10 }
const RATE_LIMIT_KEY_PREFIX = 'keys-rate-limit:cloudflare-gateway:delete'

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
      eq(schema.keys.provider, 'cloudflare-gateway'),
    ))

  recordKeyEvent('cloudflare-gateway', 'deleted')

  return setResponseStatus(event, 204, 'API key deleted successfully')
})
