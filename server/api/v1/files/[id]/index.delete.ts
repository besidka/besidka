import { createError } from 'evlog'
import { z } from 'zod'
import { deleteOwnedFile } from '~~/server/utils/files/delete-files'
import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const paramsSchema = z.object({
  id: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const params = paramsSchema.safeParse(event.context.params)

  if (!params.success) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const outcome = await deleteOwnedFile({
    userId: parseInt(session.user.id),
    fileId: params.data.id,
    logger,
  })

  if (outcome === 'not_found') {
    throw createError({
      message: 'File not found',
      status: 404,
    })
  }

  if (outcome === 'storage_error') {
    throw createError({
      message: 'Failed to delete file from storage. Please try again.',
      status: 409,
    })
  }

  return setResponseStatus(event, 204, 'File deleted successfully')
})
