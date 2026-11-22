import type { ArtifactShareSummary } from '#shared/utils/artifacts'
import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import {
  ARTIFACT_MAX_VERSIONS,
  ARTIFACT_SHARE_DURATIONS,
} from '#shared/utils/artifacts'
import { resolveArtifactShareOwnerRequest } from '~~/server/utils/artifacts/share-owner-request'
import { createArtifactShare } from '~~/server/utils/artifacts/shares'
import { durationToExpiresAt } from '~~/server/utils/chats/share'
import { assertSameOriginAdminRequest } from '~~/server/utils/features/admin-request'
import { requireFeature } from '~~/server/utils/features/guards'
import { resolveRequestPublicOrigin } from '~~/server/utils/request-public-origin'

const bodySchema = z.object({
  duration: z.enum(ARTIFACT_SHARE_DURATIONS),
  pinnedVersion: z.number().int().min(1).max(ARTIFACT_MAX_VERSIONS).nullable(),
  storageAllowed: z.boolean(),
  bridgeAllowed: z.boolean(),
})

export default defineEventHandler(async (
  event,
): Promise<{ share: ArtifactShareSummary, url: string }> => {
  await requireFeature(event, 'artifacts.share')

  assertNotCrossSiteRequest(event)
  assertSameOriginAdminRequest(event)

  const request = await resolveArtifactShareOwnerRequest(event, 'share-create')
  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (!body.success) {
    throw createError({
      message: 'Invalid share link settings',
      status: 400,
      why: body.error.message,
    })
  }

  const created = await createArtifactShare({
    db: useDb(),
    userId: request.userId,
    artifactId: request.artifactId,
    expiresAt: durationToExpiresAt(body.data.duration),
    pinnedVersion: body.data.pinnedVersion,
    storageAllowed: body.data.storageAllowed,
    bridgeAllowed: body.data.bridgeAllowed,
    createdVia: 'ui',
    baseUrl: resolveRequestPublicOrigin(event),
  })

  request.logger.set({
    attributes: {
      artifacts: {
        shareId: created.share.shareId,
        duration: body.data.duration,
        pinned: body.data.pinnedVersion !== null,
        storageAllowed: body.data.storageAllowed,
        bridgeAllowed: body.data.bridgeAllowed,
      },
    },
  })

  return { share: created.share, url: created.url }
})
