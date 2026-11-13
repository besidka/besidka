import { defineEventHandler } from 'nuxt/server'
import { requireFeature } from '~~/server/utils/features/guards'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { enforceSkillImportRateLimit } from '~~/server/utils/skills/import/rate-limit'
import { checkGithubSkillUpdate } from '~~/server/utils/skills/import/update-check'

/**
 * Looks for a newer commit of a skill imported from GitHub. Unchanged: the
 * answer is `{ upToDate: true }`. Changed: the new files become a persisted
 * pending version and the answer carries its diff against the current
 * version, the findings that are new in it and any licence change. The skill
 * keeps running on its current version until the pending one is accepted.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  await requireFeature(event, 'skills')
  await requireFeature(event, 'skills.import-url')

  const userId = parseInt(session.user.id)

  await enforceSkillImportRateLimit(event, userId)

  const { id } = getDecodedRouterParams(event)

  logger.set({ userId })

  return await checkGithubSkillUpdate({
    db: useDb(),
    bucket: useFileStorage(),
    userId,
    skillId: id ?? '',
    logger,
  })
})
