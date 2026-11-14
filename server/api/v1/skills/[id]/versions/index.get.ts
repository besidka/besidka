import { defineEventHandler } from 'nuxt/server'
import {
  readSkillIdParam,
  requireSkillsSession,
} from '~~/server/utils/skills/versions/route'
import { listSkillVersions } from '~~/server/utils/skills/versions/view'

/**
 * The versions that are kept, newest first, with the current and the pending
 * one marked.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireSkillsSession(event)

  return await listSkillVersions(useDb(), userId, readSkillIdParam(event))
})
