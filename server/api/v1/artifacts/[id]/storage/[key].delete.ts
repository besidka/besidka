import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import {
  deleteArtifactStorageValue,
  enforceArtifactStorageWriteLimit,
} from '~~/server/utils/artifacts/viewer-storage'
import { resolveArtifactStorageRequest } from '~~/server/utils/artifacts/viewer-storage-request'
import { requireFeature } from '~~/server/utils/features/guards'

export default defineEventHandler(async (event) => {
  await requireFeature(event, 'artifacts.storage')

  const { scope, key, logger } = await resolveArtifactStorageRequest(
    event,
    'delete',
  )

  if (!key) {
    throw createError({
      message: 'Invalid saved progress key',
      status: 400,
      why: 'The key is missing',
    })
  }

  await enforceArtifactStorageWriteLimit(event, scope, logger)

  const totals = await deleteArtifactStorageValue({ ...scope, key })

  logger.set({
    attributes: {
      artifacts: { storageKeys: totals.keys, storageBytes: totals.bytes },
    },
  })

  return totals
})
