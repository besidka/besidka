import { defineEventHandler } from 'nuxt/server'
import { resolveArtifactShareOwnerRequest } from '~~/server/utils/artifacts/share-owner-request'
import {
  decodeArtifactShareId,
  revokeArtifactShares,
} from '~~/server/utils/artifacts/shares'
import { createArtifactNotFoundError, decodeArtifactId } from '~~/server/utils/artifacts/store'
import { requireFeature } from '~~/server/utils/features/guards'
import * as schema from '~~/server/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireFeature(event, 'artifacts.share')

  assertNotCrossSiteRequest(event)

  const request = await resolveArtifactShareOwnerRequest(event, 'share-revoke')
  const artifactInternalId = decodeArtifactId(request.artifactId)
  const shareInternalId = decodeArtifactShareId(request.shareId ?? '')

  if (artifactInternalId === null || shareInternalId === null) {
    throw createArtifactNotFoundError()
  }

  const db = useDb()
  const [share] = await db
    .select({ id: schema.artifactShares.id })
    .from(schema.artifactShares)
    .where(and(
      eq(schema.artifactShares.id, shareInternalId),
      eq(schema.artifactShares.artifactId, artifactInternalId),
    ))
    .limit(1)

  if (!share) {
    throw createArtifactNotFoundError()
  }

  const result = await revokeArtifactShares({
    db,
    userId: request.userId,
    shareIds: [request.shareId!],
  })

  if (result.notFound.length > 0) {
    throw createArtifactNotFoundError()
  }

  request.logger.set({ attributes: { artifacts: { revoked: result.revoked } } })

  return { revoked: result.revoked }
})
