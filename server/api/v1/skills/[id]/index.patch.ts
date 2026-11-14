import { defineEventHandler } from 'nuxt/server'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import {
  readSkillBody,
  readSkillIdParam,
  requireSkillsSession,
  settingsBodySchema,
} from '~~/server/utils/skills/versions/route'
import { updateSkillSettings } from '~~/server/utils/skills/versions/settings'

const BODY_MAX_BYTES = 4096

/**
 * Settings only: `mode` and `argumentHint`. The three columns behind the mode
 * (`enabled`, `model_invocable`, `slash_command`) are never written one by
 * one. Content (the name, the description, every file) changes through a
 * version, so this route never creates one.
 */
export default defineEventHandler(async (event) => {
  const { logger, userId } = await requireSkillsSession(event)

  assertRequestBodyLength(event, BODY_MAX_BYTES)

  const changes = await readSkillBody(
    event,
    settingsBodySchema,
    'Send mode, argumentHint, or both',
  )

  return await updateSkillSettings({
    db: useDb(),
    userId,
    skillId: readSkillIdParam(event),
    changes: {
      ...(changes.mode === undefined ? {} : { mode: changes.mode }),
      ...(changes.argumentHint === undefined
        ? {}
        : { argumentHint: changes.argumentHint?.trim() || null }),
    },
    logger,
  })
})
