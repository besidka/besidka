import { createError } from 'evlog'
import { z } from 'zod'
import {
  recomputeUserFileExpiry,
} from '~~/server/utils/files/file-governance'
import { defineEventHandler, getRequestHeader, readBody } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  userId: z.coerce.number().int().positive(),
  graceDays: z.coerce.number().int().min(0).max(365).optional(),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const maintenanceToken = useRuntimeConfig().filesMaintenanceToken

  if (!maintenanceToken) {
    throw createError({
      message: 'Not found',
      status: 404,
    })
  }

  const headerToken = getRequestHeader(event, 'x-maintenance-token')

  if (headerToken !== maintenanceToken) {
    throw createError({
      message: 'Forbidden',
      status: 403,
    })
  }

  const rawBody = await readBody(event)
  const body = bodySchema.safeParse(rawBody)

  if (!body.success) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const result = await recomputeUserFileExpiry(
    body.data.userId,
    {
      graceDays: body.data.graceDays,
    },
  )

  logger.set({
    retentionRecompute: result,
  })

  return result
})
