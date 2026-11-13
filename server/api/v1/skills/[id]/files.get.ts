import { defineEventHandler, getQuery } from 'nuxt/server'
import { readSkillVersionFiles } from '~~/server/utils/skills/versions/files'
import {
  readSkillIdParam,
  readSkillQuery,
  requireSkillsSession,
  versionQuerySchema,
} from '~~/server/utils/skills/versions/route'

/**
 * The files of a version (the current one unless `?version=` names another):
 * the list, or with `?path=` one file as plain text, up to 1 MiB.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireSkillsSession(event)
  const query = readSkillQuery(
    getQuery(event),
    versionQuerySchema,
    'Pass version and path as query parameters',
  )

  return await readSkillVersionFiles({
    db: useDb(),
    bucket: useFileStorage(),
    userId,
    skillId: readSkillIdParam(event),
    version: query.version,
    path: query.path,
  })
})
