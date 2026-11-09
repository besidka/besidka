import { defineEventHandler } from 'nuxt/server'
import {
  enforceArtifactStorageWriteLimit,
  resetArtifactStorage,
} from '~~/server/utils/artifacts/viewer-storage'
import { resolveArtifactStorageRequest } from '~~/server/utils/artifacts/viewer-storage-request'
import { requireFeature } from '~~/server/utils/features/guards'

export default defineEventHandler(async (event) => {
  await requireFeature(event, 'artifacts.storage')

  const { scope, logger } = await resolveArtifactStorageRequest(
    event,
    'reset',
  )

  await enforceArtifactStorageWriteLimit(event, scope)

  const deleted = await resetArtifactStorage(scope)

  logger.set({ attributes: { artifacts: { storageDeleted: deleted } } })

  return { keys: 0, bytes: 0, deleted }
})
