import { defineEventHandler } from 'nuxt/server'
import { submitArtifactReport } from '~~/server/utils/artifacts/reports'
import { requireActiveArtifactShare } from '~~/server/utils/artifacts/share-request'
import { encodeArtifactShareId } from '~~/server/utils/artifacts/shares'
import { encodeArtifactId } from '~~/server/utils/artifacts/store'

export default defineEventHandler(async (event) => {
  const resolved = await requireActiveArtifactShare(event)

  return await submitArtifactReport(event, async () => {
    return {
      artifactInternalId: resolved.artifact.id,
      shareInternalId: resolved.share.id,
      chatShareId: null,
      location: {
        kind: 'artifact-share',
        artifactId: encodeArtifactId(resolved.artifact.id),
        shareId: encodeArtifactShareId(resolved.share.id),
        chatShareId: null,
        title: resolved.artifact.title,
      },
    }
  })
})
