import type { ArtifactSharePublicView } from '#shared/utils/artifacts'
import { defineEventHandler } from 'nuxt/server'
import { useArtifactBlobStore } from '~~/server/utils/artifacts/blob-store'
import { requireActiveArtifactShare } from '~~/server/utils/artifacts/share-request'
import { encodeArtifactShareId } from '~~/server/utils/artifacts/shares'
import { readResolvedArtifactVersion } from '~~/server/utils/artifacts/store'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (
  event,
): Promise<ArtifactSharePublicView> => {
  const logger = useRequestLogger(event)
  const resolved = await requireActiveArtifactShare(event)
  const content = await readResolvedArtifactVersion({
    db: useDb(),
    storage: useArtifactBlobStore(),
    artifact: resolved.artifact,
    version: resolved.version,
  })

  logger.set({
    attributes: {
      artifacts: {
        operation: 'share-read',
        artifactId: content.artifactId,
        version: content.version,
        pinned: resolved.share.pinnedVersion !== null,
      },
    },
  })

  return {
    shareId: encodeArtifactShareId(resolved.share.id),
    artifactId: content.artifactId,
    title: resolved.share.title ?? content.title,
    kind: content.kind,
    version: content.version,
    pinned: resolved.share.pinnedVersion !== null,
    content: content.content,
    createdAt: content.createdAt,
    expiresAt: resolved.share.expiresAt?.toISOString() ?? null,
    capabilities: {
      storageAllowed: resolved.share.storageAllowed,
      bridgeAllowed: resolved.share.bridgeAllowed,
    },
  }
})
