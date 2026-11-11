import { createError } from 'evlog'
import { z } from 'zod'
import { defineEventHandler } from 'nuxt/server'
import { submitArtifactReport } from '~~/server/utils/artifacts/reports'
import { resolveSharedChatArtifact } from '~~/server/utils/artifacts/shared-chat'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'

const paramsSchema = z.object({
  slug: z.string().min(1).max(64),
  artifactId: z.string().min(1).max(64),
})

export default defineEventHandler(async (event) => {
  const params = paramsSchema.safeParse(getDecodedRouterParams(event))

  if (!params.success) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  return await submitArtifactReport(event, async (body) => {
    const artifact = await resolveSharedChatArtifact({
      event,
      slug: params.data.slug,
      artifactId: params.data.artifactId,
      version: body.version,
    })

    return {
      artifactInternalId: artifact.internalId,
      shareInternalId: null,
      chatShareId: artifact.shareId,
      reportedVersion: body.version ?? null,
      location: {
        kind: 'shared-chat',
        artifactId: params.data.artifactId,
        shareId: null,
        chatShareId: artifact.shareId,
      },
    }
  })
})
