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
 * Settings only: `mode` (or `enabled`, `modelInvocable` and `slashCommand`)
 * and `argumentHint`. Content (the name, the description, every file) changes
 * through a version, so this route never creates one.
 */
export default defineEventHandler(async (event) => {
  const { logger, userId } = await requireSkillsSession(event)

  assertRequestBodyLength(event, BODY_MAX_BYTES)

  const changes = await readSkillBody(
    event,
    settingsBodySchema,
    'Send mode, or one or more of enabled, modelInvocable, slashCommand, argumentHint',
  )

  return await updateSkillSettings({
    db: useDb(),
    userId,
    skillId: readSkillIdParam(event),
    changes: {
      ...(changes.mode === undefined ? {} : { mode: changes.mode }),
      ...(changes.enabled === undefined ? {} : { enabled: changes.enabled }),
      ...(changes.modelInvocable === undefined
        ? {}
        : { modelInvocable: changes.modelInvocable }),
      ...(changes.slashCommand === undefined
        ? {}
        : { slashCommand: changes.slashCommand }),
      ...(changes.argumentHint === undefined
        ? {}
        : { argumentHint: changes.argumentHint?.trim() || null }),
    },
    logger,
  })
})
