import * as schema from '~~/server/db/schema'

const RATE_LIMIT_RULE = { window: 60, max: 30 }
const RATE_LIMIT_KEY_PREFIX = 'keys-rate-limit:summary:get'

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

  const rows = await useDb().query.keys.findMany({
    where: {
      userId: parseInt(session.user.id),
    },
    columns: {
      provider: true,
    },
  })

  const providersWithKeys = new Set(rows.map(row => row.provider))

  const keys = schema.keys.provider.enumValues.map((provider) => {
    return {
      provider,
      hasKey: providersWithKeys.has(provider),
    }
  })

  return { keys }
})
