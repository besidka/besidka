import { and, eq } from 'drizzle-orm'
import { defineEventHandler } from 'nuxt/server'
import * as schema from '~~/server/db/schema'
import { resolveArtifactShareOwnerRequest } from '~~/server/utils/artifacts/share-owner-request'
import {
  decodeArtifactShareId,
  revokeArtifactShares,
} from '~~/server/utils/artifacts/shares'
import { createArtifactNotFoundError, decodeArtifactId } from '~~/server/utils/artifacts/store'
import { assertSameOriginAdminRequest } from '~~/server/utils/features/admin-request'
import { requireGlobalFeature } from '~~/server/utils/features/global'

export default defineEventHandler(async (event) => {
  await requireGlobalFeature(event, 'artifacts')

  assertNotCrossSiteRequest(event)
  assertSameOriginAdminRequest(event)

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
