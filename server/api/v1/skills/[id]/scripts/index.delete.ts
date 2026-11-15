import { defineEventHandler } from 'nuxt/server'
import { disableSkillScripts } from '~~/server/utils/skills/scripts-toggle'
import {
  readSkillIdParam,
  requireSkillsSession,
} from '~~/server/utils/skills/versions/route'

/**
 * Turns "Allow scripts" off and deletes the copy of the skill at Anthropic.
 * It does not need the Labs opt-in: switching off never spends anything.
 */
export default defineEventHandler(async (event) => {
  const { logger, userId } = await requireSkillsSession(event)

  return await disableSkillScripts({
    db: useDb(),
    userId,
    skillId: readSkillIdParam(event),
    logger,
  })
})
