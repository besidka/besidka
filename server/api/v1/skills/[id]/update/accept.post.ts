import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { requireFeature } from '~~/server/utils/features/guards'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { acceptPendingSkillVersion } from '~~/server/utils/skills/pending'

const BODY_MAX_BYTES = 4096

const bodySchema = z.object({
  version: z.number().int().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})

/**
 * Accepts the pending version the user reviewed. The body names that
 * version and its content hash; if the pending row has changed since, the
 * answer is 409 and nothing is applied. The skill is disabled afterwards.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  await requireFeature(event, 'skills')

  assertRequestBodyLength(event, BODY_MAX_BYTES)

  const { id } = getDecodedRouterParams(event)
  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      code: 'invalid-request',
      why: body.error.message,
      fix: 'Send { version, sha256 } of the pending version you reviewed',
    })
  }

  const userId = parseInt(session.user.id)

  logger.set({ userId })

  const result = await acceptPendingSkillVersion({
    db: useDb(),
    bucket: useFileStorage(),
    userId,
    skillId: id ?? '',
    version: body.data.version,
    sha256: body.data.sha256,
  })

  logger.set({
    attributes: {
      skills: { update: { operation: 'accept', version: result.version } },
    },
  })

  return result
})
