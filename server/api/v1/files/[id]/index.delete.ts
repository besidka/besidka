import { useLogger } from 'evlog'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'

const paramsSchema = z.object({
  id: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const params = paramsSchema.safeParse(event.context.params)

  if (!params.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request parameters',
      data: params.error.flatten(),
    })
  }

  const { id } = params.data
  const userId = parseInt(session.user.id)
  const db = useDb()

  const file = await db.query.files.findFirst({
    where: and(
      eq(schema.files.id, id),
      eq(schema.files.userId, userId),
    ),
    columns: {
      storageKey: true,
    },
  })

  if (!file) {
    throw createError({
      statusCode: 404,
      statusMessage: 'File not found',
    })
  }

  try {
    await useFileStorage().delete(file.storageKey)
  } catch (exception) {
    logger.set({
      storage: {
        operation: 'delete',
        fileId: id,
        key: file.storageKey,
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })

    throw createError({
      statusCode: 409,
      statusMessage: 'Failed to delete file from storage. Please try again.',
    })
  }

  try {
    await invalidateFileCache(file.storageKey)
  } catch (exception) {
    logger.set({
      cache: {
        operation: 'invalidate',
        fileId: id,
        key: file.storageKey,
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })
  }

  await db
    .delete(schema.files)
    .where(and(
      eq(schema.files.id, id),
      eq(schema.files.userId, userId),
    ))

  await invalidateStorageCache(userId)

  return setResponseStatus(event, 204, 'File deleted successfully')
})
