import { createError } from 'evlog'
import { z } from 'zod'
import { ARTIFACT_MAX_VERSIONS } from '#shared/utils/artifacts'
import { defineEventHandler } from 'nuxt/server'
import { useArtifactBlobStore } from '~~/server/utils/artifacts/blob-store'
import { readArtifactVersion } from '~~/server/utils/artifacts/store'
import { requireFeature } from '~~/server/utils/features/guards'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const VERSION_CACHE_CONTROL = 'private, no-store'

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
  version: z.coerce.number().int().min(1).max(ARTIFACT_MAX_VERSIONS),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  await requireFeature(event, 'artifacts')

  const params = paramsSchema.safeParse(getDecodedRouterParams(event))

  if (!params.success) {
    throw createError({
      message: 'Invalid artifact version',
      status: 400,
      why: params.error.message,
    })
  }

  const userId = parseInt(session.user.id)

  logger.set({
    userId,
    attributes: {
      artifacts: {
        operation: 'read-version',
        artifactId: params.data.id,
        version: params.data.version,
      },
    },
  })

  const content = await readArtifactVersion({
    db: useDb(),
    storage: useArtifactBlobStore(),
    userId,
    artifactId: params.data.id,
    version: params.data.version,
  })

  event.res.headers.set('Cache-Control', VERSION_CACHE_CONTROL)

  return content
})
