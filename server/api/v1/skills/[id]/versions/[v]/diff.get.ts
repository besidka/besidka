import { defineEventHandler, getQuery } from 'nuxt/server'
import { diffSkillVersions } from '~~/server/utils/skills/versions/diff'
import {
  diffQuerySchema,
  readSkillIdParam,
  readSkillQuery,
  readVersionParam,
  requireSkillsSession,
} from '~~/server/utils/skills/versions/route'

/**
 * What changes if version `v` replaces the current version (or `?against=`
 * another): per-file `+` and `-` lines, at most 2,000 lines and 50 files.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireSkillsSession(event)
  const query = readSkillQuery(
    getQuery(event),
    diffQuerySchema,
    'Pass against as a version number',
  )

  return await diffSkillVersions({
    db: useDb(),
    bucket: useFileStorage(),
    userId,
    skillId: readSkillIdParam(event),
    version: readVersionParam(event),
    against: query.against,
  })
})
