import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import {
  enforceArtifactStorageWriteLimit,
  putArtifactStorageValue,
} from '~~/server/utils/artifacts/viewer-storage'
import { resolveArtifactStorageRequest } from '~~/server/utils/artifacts/viewer-storage-request'
import { requireFeature } from '~~/server/utils/features/guards'

const bodySchema = z.object({
  value: z.unknown(),
}).refine((body) => {
  return body.value !== undefined
}, 'The value is missing')

export default defineEventHandler(async (event) => {
  await requireFeature(event, 'artifacts.storage')

  const { scope, key, logger } = await resolveArtifactStorageRequest(
    event,
    'set',
  )

  if (!key) {
    throw createError({
      message: 'Invalid saved progress key',
      status: 400,
      why: 'The key is missing',
    })
  }

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (!body.success) {
    throw createError({
      message: 'Invalid saved value',
      status: 400,
      why: body.error.message,
    })
  }

  await enforceArtifactStorageWriteLimit(event, scope)

  const totals = await putArtifactStorageValue({
    ...scope,
    key,
    value: body.data.value,
  })

  logger.set({
    attributes: {
      artifacts: { storageKeys: totals.keys, storageBytes: totals.bytes },
    },
  })

  return totals
})
