import { createError } from 'evlog'
import { z } from 'zod'
import { ARTIFACT_BULK_DELETE_MAX } from '#shared/utils/artifacts'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { useArtifactBlobStore } from '~~/server/utils/artifacts/blob-store'
import { deleteArtifacts } from '~~/server/utils/artifacts/store'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(ARTIFACT_BULK_DELETE_MAX),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  await requireFeature(event, 'artifacts', { active: false })

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (!body.success) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const userId = parseInt(session.user.id)
  const result = await deleteArtifacts({
    db: useDb(),
    storage: useArtifactBlobStore(),
    userId,
    artifactIds: body.data.ids,
    logger,
  })

  logger.set({
    userId,
    attributes: {
      artifacts: {
        operation: 'bulk-delete',
        requested: body.data.ids.length,
        deleted: result.deletedIds.length,
        held: result.heldIds.length,
        objectsDeleted: result.objectsDeleted,
      },
    },
  })

  if (result.deletedIds.length === 0 && result.heldIds.length === 0) {
    throw createError({
      message: 'Artifact not found',
      status: 404,
      why: 'None of these artifacts belong to your account',
    })
  }

  return {
    deletedIds: result.deletedIds,
    heldIds: result.heldIds,
  }
})
