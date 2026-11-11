import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { ARTIFACT_MAX_VERSIONS } from '#shared/utils/artifacts'
import { useArtifactBlobStore } from '~~/server/utils/artifacts/blob-store'
import { readArtifactVersionForAdmin } from '~~/server/utils/artifacts/store'
import { logFeatureAdminRead } from '~~/server/utils/features/admin'
import { requireAdmin } from '~~/server/utils/features/guards'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
  version: z.coerce.number().int().min(1).max(ARTIFACT_MAX_VERSIONS),
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  event.res.headers.set('Cache-Control', 'private, no-store')

  const params = paramsSchema.safeParse(getDecodedRouterParams(event))

  if (!params.success) {
    throw createError({
      message: 'Invalid artifact version',
      status: 400,
      why: params.error.message,
    })
  }

  const logger = useRequestLogger(event)
  const content = await readArtifactVersionForAdmin({
    db: useDb(),
    storage: useArtifactBlobStore(),
    artifactId: params.data.id,
    version: params.data.version,
  })

  logFeatureAdminRead(logger, 'artifact-version', 1)
  logger.set({
    attributes: {
      artifacts: {
        operation: 'admin-read-version',
        artifactId: params.data.id,
        version: params.data.version,
      },
    },
  })

  return content
})
