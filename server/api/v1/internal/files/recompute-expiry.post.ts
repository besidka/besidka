import { useLogger } from 'evlog'
import { z } from 'zod'
import {
  recomputeUserFileExpiry,
} from '~~/server/utils/files/file-governance'

const bodySchema = z.object({
  userId: z.coerce.number().int().positive(),
  graceDays: z.coerce.number().int().min(0).max(365).optional(),
})

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const maintenanceToken = useRuntimeConfig().filesMaintenanceToken

  if (!maintenanceToken) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not found',
    })
  }

  const headerToken = getRequestHeader(event, 'x-maintenance-token')

  if (headerToken !== maintenanceToken) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    })
  }

  const rawBody = await readBody(event)
  const body = bodySchema.safeParse(rawBody)

  if (!body.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: body.error.flatten(),
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
