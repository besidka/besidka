import { createError } from 'evlog'
import { z } from 'zod'
import { ARTIFACT_MAX_VERSIONS } from '#shared/utils/artifacts'
import { defineEventHandler } from 'nuxt/server'
import { useArtifactBlobStore } from '~~/server/utils/artifacts/blob-store'
import { resolveSharedChatArtifact } from '~~/server/utils/artifacts/shared-chat'
import { readArtifactVersionForShare } from '~~/server/utils/artifacts/store'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const VERSION_CACHE_CONTROL = 'private, no-store'

const paramsSchema = z.object({
  slug: z.string().min(1).max(64),
  artifactId: z.string().min(1).max(64),
  version: z.coerce.number().int().min(1).max(ARTIFACT_MAX_VERSIONS),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  event.res.headers.set('Cache-Control', VERSION_CACHE_CONTROL)

  const params = paramsSchema.safeParse(getDecodedRouterParams(event))

  if (!params.success) {
    throw createError({
      message: 'Invalid artifact version',
      status: 400,
      why: params.error.message,
    })
  }

  logger.set({
    attributes: {
      artifacts: {
        operation: 'shared-read-version',
        artifactId: params.data.artifactId,
        version: params.data.version,
      },
    },
  })

  const artifact = await resolveSharedChatArtifact({
    event,
    slug: params.data.slug,
    artifactId: params.data.artifactId,
    version: params.data.version,
  })

  logger.set({
    attributes: {
      artifacts: { chatShareId: artifact.shareId },
    },
  })

  return readArtifactVersionForShare({
    db: useDb(),
    storage: useArtifactBlobStore(),
    chatOwnerUserId: artifact.chatOwnerUserId,
    artifactId: params.data.artifactId,
    version: params.data.version,
  })
})
