import { defineEventHandler } from 'nuxt/server'
import { SKILL_SAVE_REQUEST_MAX_BYTES } from '#shared/utils/skills-policy'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { enforceSkillSaveRateLimit } from '~~/server/utils/skills/import/rate-limit'
import {
  readSkillBody,
  readSkillIdParam,
  requireSkillsSession,
  saveBodySchema,
} from '~~/server/utils/skills/versions/route'
import { saveSkillChanges } from '~~/server/utils/skills/versions/save'

/**
 * A save: `{ baseVersion, changes, note? }` creates the next version. A stale
 * `baseVersion` answers 409 and writes nothing. A name changed inside
 * SKILL.md renames the skill through the same save. 120 saves an hour.
 */
export default defineEventHandler(async (event) => {
  const { logger, userId } = await requireSkillsSession(event)

  assertRequestBodyLength(event, SKILL_SAVE_REQUEST_MAX_BYTES)

  await enforceSkillSaveRateLimit(event, userId)

  const body = await readSkillBody(
    event,
    saveBodySchema,
    'Send { baseVersion, changes: [{ op, ... }], note? } with at most 50 changes',
  )

  return await saveSkillChanges({
    db: useDb(),
    bucket: useFileStorage(),
    userId,
    skillId: readSkillIdParam(event),
    baseVersion: body.baseVersion,
    changes: body.changes,
    note: body.note?.trim() || null,
    logger,
  })
})
