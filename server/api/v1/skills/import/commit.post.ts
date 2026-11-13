import { createError } from 'evlog'
import {
  defineEventHandler,
  readValidatedBody,
  setResponseStatus,
} from 'nuxt/server'
import { z } from 'zod'
import { SKILL_NAME_MAX } from '#shared/utils/skills-policy'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { commitSkillImport } from '~~/server/utils/skills/import/commit'
import { SKILL_STAGE_ID_PATTERN } from '~~/server/utils/skills/import/stage'

const BODY_MAX_BYTES = 4096

const bodySchema = z.object({
  stageId: z.string().regex(SKILL_STAGE_ID_PATTERN),
  acknowledged: z.literal(true),
  licenceAcknowledged: z.boolean().optional(),
  asUpdateOf: z.string().regex(/^[A-Za-z0-9]{1,64}$/).optional(),
  name: z.string().min(1).max(SKILL_NAME_MAX).optional(),
})

/**
 * Installs a staged import. A new skill is created disabled with version 1
 * (origin `import`). A name collision answers 409 with
 * `{ stageId, asUpdateOf }`; sending `asUpdateOf` turns the staged files into
 * a pending version of that skill, and sending `name` renames the incoming
 * skill.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  await requireFeature(event, 'skills')

  assertRequestBodyLength(event, BODY_MAX_BYTES)

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      code: 'invalid-request',
      why: body.error.message,
      fix: 'Send { stageId, acknowledged: true } from the preview step',
    })
  }

  const userId = parseInt(session.user.id)

  logger.set({ userId })

  const result = await commitSkillImport({
    db: useDb(),
    bucket: useFileStorage(),
    kv: useKV(),
    userId,
    stageId: body.data.stageId,
    licenceAcknowledged: body.data.licenceAcknowledged,
    name: body.data.name,
    asUpdateOf: body.data.asUpdateOf,
    logger,
  })

  setResponseStatus(event, result.kind === 'created' ? 201 : 200)

  return result
})
