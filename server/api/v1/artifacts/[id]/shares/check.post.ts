import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { ARTIFACT_MAX_VERSIONS } from '#shared/utils/artifacts'
import { useArtifactBlobStore } from '~~/server/utils/artifacts/blob-store'
import { resolveArtifactShareOwnerRequest } from '~~/server/utils/artifacts/share-owner-request'
import { readArtifactVersion } from '~~/server/utils/artifacts/store'
import { detectSharePii } from '~~/server/utils/chats/share-pii-check'
import { assertSameOriginAdminRequest } from '~~/server/utils/features/admin-request'
import { requireFeature } from '~~/server/utils/features/guards'

const bodySchema = z.object({
  pinnedVersion: z.number().int().min(1).max(ARTIFACT_MAX_VERSIONS).nullable(),
})

export default defineEventHandler(async (
  event,
): Promise<{ warnings: string[] }> => {
  await requireFeature(event, 'artifacts.share')

  assertNotCrossSiteRequest(event)
  assertSameOriginAdminRequest(event)

  const request = await resolveArtifactShareOwnerRequest(event, 'share-check')
  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (!body.success) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const version = await readArtifactVersion({
    db: useDb(),
    storage: useArtifactBlobStore(),
    userId: request.userId,
    artifactId: request.artifactId,
    version: body.data.pinnedVersion ?? undefined,
  })
  const { kinds } = detectSharePii([
    `Title: ${version.title}`,
    version.content,
  ])

  request.logger.set({
    attributes: {
      artifacts: { piiKinds: kinds, version: version.version },
    },
  })

  return { warnings: kinds }
})
