import { defineEventHandler } from 'nuxt/server'
import {
  readSkillIdParam,
  requireSkillsSession,
} from '~~/server/utils/skills/versions/route'
import { getSkillDetail } from '~~/server/utils/skills/versions/view'

/**
 * One skill with its current files, its licence and its pending update.
 * File contents come from `GET /skills/[id]/files`.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireSkillsSession(event)

  return await getSkillDetail(useDb(), userId, readSkillIdParam(event))
})
