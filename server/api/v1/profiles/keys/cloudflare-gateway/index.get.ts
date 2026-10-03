const RATE_LIMIT_RULE = { window: 60, max: 30 }
const RATE_LIMIT_KEY_PREFIX = 'keys-rate-limit:cloudflare-gateway:get'

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

  const credentials = await getCloudflareGatewayCredentials(session.user.id)

  if (!credentials) {
    return { accountId: '', gatewayId: '', hasKey: false }
  }

  return {
    accountId: credentials.accountId,
    gatewayId: credentials.gatewayId ?? '',
    hasKey: true,
  }
})
