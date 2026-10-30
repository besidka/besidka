import { createError } from 'evlog'
import { z } from 'zod'
import { deleteOwnedFiles } from '~~/server/utils/files/delete-files'
import { defineEventHandler, readBody, setResponseStatus } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
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

  const result = await deleteOwnedFiles({
    userId: parseInt(session.user.id),
    fileIds: body.data.ids,
    logger,
  })
  const { deleted } = result
  const failed = [...result.failed, ...result.errored]

  if (deleted.length === 0) {
    throw createError({
      message: failed.length > 0
        ? 'Failed to delete files from storage. Please try again.'
        : 'No files found',
      status: failed.length > 0 ? 409 : 404,
    })
  }

  if (failed.length > 0) {
    throw createError({
      message: `Failed to delete ${failed.length} file(s) from storage`,
      status: 409,
    })
  }

  return setResponseStatus(event, 204, 'Files deleted successfully')
})
