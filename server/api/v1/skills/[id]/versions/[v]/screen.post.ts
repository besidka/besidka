import { defineEventHandler } from 'nuxt/server'
import { screenSkillVersion } from '~~/server/utils/skills/jev/screen'
import { openSkillScreenRequest } from '~~/server/utils/skills/jev/route'
import {
  readSkillIdParam,
  readVersionParam,
} from '~~/server/utils/skills/versions/route'

/**
 * The optional TypeSafe AI check of one stored version of a skill, for the
 * update and needs-review screens. Same rules as the import screen: the
 * user's own key and the "Prompt-injection screening" role, add-only
 * highlights, line ranges for what was not checked, no "clean" state, and a
 * failure leaves the review as it is. The marks (line ranges and scores, no
 * text) are kept with the version.
 */
export default defineEventHandler(async (event) => {
  const { logger, userId, rest } = await openSkillScreenRequest(event)

  return await screenSkillVersion({
    db: useDb(),
    kv: useKV(),
    bucket: useFileStorage(),
    userId,
    skillId: readSkillIdParam(event),
    version: readVersionParam(event),
    rest,
    logger,
  })
})
