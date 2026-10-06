import { createError } from 'evlog'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
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

  const { id } = params.data
  const userId = parseInt(session.user.id)
  const db = useDb()

  const file = await db.query.files.findFirst({
    where: {
      id,
      userId,
    },
    columns: {
      storageKey: true,
    },
  })

  if (!file) {
    throw createError({
      message: 'File not found',
      status: 404,
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
      },
      attributes: {
        storage: {
          error: exceptionMessage(exception),
        },
      },
    })

    throw createError({
      message: 'Failed to delete file from storage. Please try again.',
      status: 409,
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
      },
      attributes: {
        cache: {
          error: exceptionMessage(exception),
        },
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
