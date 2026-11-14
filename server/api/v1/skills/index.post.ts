import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { enforceSkillSaveRateLimit } from '~~/server/utils/skills/import/rate-limit'
import { createAuthoredSkill } from '~~/server/utils/skills/versions/create'
import {
  createBodySchema,
  readSkillBody,
  requireSkillsSession,
} from '~~/server/utils/skills/versions/route'

const BODY_MAX_BYTES = 8192

/**
 * Creates a skill the user writes in the app: a blank skill, a blank command
 * or one of Besidka's templates. It is class `authored`, saved enabled with
 * version 1, and counts as one of the 120 saves an hour.
 */
export default defineEventHandler(async (event) => {
  const { logger, userId } = await requireSkillsSession(event)

  assertRequestBodyLength(event, BODY_MAX_BYTES)

  await enforceSkillSaveRateLimit(event, userId)

  const request = await readSkillBody(
    event,
    createBodySchema,
    'Send { kind: "blank" | "command", name } or { kind: "template", template }',
  )
  const created = await createAuthoredSkill({
    db: useDb(),
    bucket: useFileStorage(),
    userId,
    request,
    logger,
  })

  setResponseStatus(event, 201)

  return created
})
