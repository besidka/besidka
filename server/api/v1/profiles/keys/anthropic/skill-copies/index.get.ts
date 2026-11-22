import { defineEventHandler } from 'nuxt/server'
import { listLiveProviderCopies } from '~~/server/utils/skills/provider-upload'

const RATE_LIMIT_RULE = { window: 60, max: 60 }
const RATE_LIMIT_KEY_PREFIX = 'keys-rate-limit:anthropic:uploads:get'

/**
 * The skills that still have a copy in the user's Anthropic workspace. The
 * key page reads it before the key is removed, because without the key
 * Besidka can no longer delete those copies.
 */
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

  return {
    skills: await listLiveProviderCopies(
      useDb(),
      parseInt(session.user.id),
    ),
  }
})
