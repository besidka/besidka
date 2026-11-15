import { defineEventHandler } from 'nuxt/server'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { enforceSkillSaveRateLimit } from '~~/server/utils/skills/import/rate-limit'
import { restoreSkillVersion } from '~~/server/utils/skills/versions/restore'
import {
  readSkillBody,
  readSkillIdParam,
  readVersionParam,
  requireSkillsSession,
  restoreBodySchema,
} from '~~/server/utils/skills/versions/route'

const BODY_MAX_BYTES = 4096

/**
 * Restores version `v` by writing its files as a new version. History is
 * never rewritten, and a pending update cannot be restored.
 */
export default defineEventHandler(async (event) => {
  const { logger, userId } = await requireSkillsSession(event)

  assertRequestBodyLength(event, BODY_MAX_BYTES)

  await enforceSkillSaveRateLimit(event, userId)

  const body = await readSkillBody(
    event,
    restoreBodySchema,
    'Send { baseVersion?, note? }',
  )

  return await restoreSkillVersion({
    db: useDb(),
    bucket: useFileStorage(),
    userId,
    skillId: readSkillIdParam(event),
    version: readVersionParam(event),
    baseVersion: body.baseVersion,
    note: body.note?.trim() || null,
    logger,
  })
})
