import type { ArtifactShareSummary } from '#shared/utils/artifacts'
import { defineEventHandler } from 'nuxt/server'
import { resolveArtifactShareOwnerRequest } from '~~/server/utils/artifacts/share-owner-request'
import { listArtifactShares } from '~~/server/utils/artifacts/shares'
import { requireGlobalFeature } from '~~/server/utils/features/global'
import { resolveRequestPublicOrigin } from '~~/server/utils/request-public-origin'

export default defineEventHandler(async (
  event,
): Promise<{ shares: ArtifactShareSummary[] }> => {
  await requireGlobalFeature(event, 'artifacts')

  const request = await resolveArtifactShareOwnerRequest(event, 'share-list')
  const shares = await listArtifactShares({
    db: useDb(),
    userId: request.userId,
    artifactId: request.artifactId,
    includeEnded: true,
    baseUrl: resolveRequestPublicOrigin(event),
  })

  request.logger.set({
    attributes: {
      artifacts: {
        shareCount: shares.length,
        activeShareCount: shares.filter((share) => {
          return share.status === 'active'
        }).length,
      },
    },
  })

  return { shares }
})
