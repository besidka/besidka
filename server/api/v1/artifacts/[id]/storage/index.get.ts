import { defineEventHandler } from 'nuxt/server'
import { listArtifactStorage } from '~~/server/utils/artifacts/viewer-storage'
import { resolveArtifactStorageRequest } from '~~/server/utils/artifacts/viewer-storage-request'
import { requireFeature } from '~~/server/utils/features/guards'

export default defineEventHandler(async (event) => {
  await requireFeature(event, 'artifacts.storage')

  const { scope, logger } = await resolveArtifactStorageRequest(event, 'list')
  const snapshot = await listArtifactStorage(scope)

  logger.set({
    attributes: {
      artifacts: { storageKeys: snapshot.keys, storageBytes: snapshot.bytes },
    },
  })
  event.res.headers.set('Cache-Control', 'private, no-store')

  return snapshot
})
