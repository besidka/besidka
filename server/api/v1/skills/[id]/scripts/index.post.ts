import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { SKILL_SCRIPTS_FEATURE_KEY } from '#shared/utils/skills/scripts'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { requireFeature } from '~~/server/utils/features/guards'
import { enableSkillScripts } from '~~/server/utils/skills/scripts-toggle'
import {
  readSkillBody,
  readSkillIdParam,
  requireSkillsSession,
} from '~~/server/utils/skills/versions/route'

const BODY_MAX_BYTES = 1024

const bodySchema = z.object({
  disclosureAccepted: z.boolean(),
  renameConfirmed: z.boolean().optional(),
}).strict()

/**
 * Turns "Allow scripts" on for one skill after the disclosure. It needs the
 * `skills.scripts` flag and the Labs opt-in, because running the scripts
 * spends the user's own Anthropic key.
 */
export default defineEventHandler(async (event) => {
  const { logger, userId } = await requireSkillsSession(event)

  await requireFeature(event, SKILL_SCRIPTS_FEATURE_KEY)
  assertRequestBodyLength(event, BODY_MAX_BYTES)

  const body = await readSkillBody(
    event,
    bodySchema,
    'Send disclosureAccepted and, when asked, renameConfirmed',
  )

  return await enableSkillScripts({
    db: useDb(),
    userId,
    skillId: readSkillIdParam(event),
    isDisclosureAccepted: body.disclosureAccepted,
    isRenameConfirmed: body.renameConfirmed === true,
    logger,
  })
})
