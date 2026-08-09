const RATE_LIMIT_RULE = { window: 60, max: 30 }
const RATE_LIMIT_KEY_PREFIX = 'keys-rate-limit:vercel-gateway:get'

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

  const data = await useDb().query.keys.findFirst({
    where: {
      userId: parseInt(session.user.id),
      provider: 'vercel-gateway',
    },
    columns: {
      apiKey: true,
    },
  })

  return data?.apiKey
    ? await useDecryptText(data.apiKey)
    : ''
})
