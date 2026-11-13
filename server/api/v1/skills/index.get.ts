import { defineEventHandler } from 'nuxt/server'
import { requireSkillsSession } from '~~/server/utils/skills/versions/route'
import { listUserSkills } from '~~/server/utils/skills/versions/view'

/**
 * The user's skills with the counts the manager's filter rows show: by source
 * group (created, imported, from apps) and by kind (skills, commands).
 */
export default defineEventHandler(async (event) => {
  const { logger, userId } = await requireSkillsSession(event)
  const result = await listUserSkills(useDb(), userId)

  logger.set({
    attributes: { skills: { list: { count: result.skills.length } } },
  })

  return result
})
