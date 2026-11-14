import { defineEventHandler } from 'nuxt/server'
import { deleteUserSkill } from '~~/server/utils/skills/cleanup'
import { loadOwnedSkill } from '~~/server/utils/skills/versions/read'
import {
  readSkillIdParam,
  requireSkillsSession,
} from '~~/server/utils/skills/versions/route'

/**
 * Deletes the skill, every version and file of it, its per-chat choices and
 * its R2 prefix. It cannot be undone; the manager asks first.
 */
export default defineEventHandler(async (event) => {
  const { logger, userId } = await requireSkillsSession(event)
  const db = useDb()
  const skill = await loadOwnedSkill(db, userId, readSkillIdParam(event))

  await deleteUserSkill(db, { userId, skillId: skill.id, logger })

  return { id: skill.id, deleted: true }
})
