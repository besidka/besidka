import { useLogger } from 'evlog'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
})

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
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

  const { ids } = body.data
  const userId = parseInt(session.user.id)
  const db = useDb()

  let deletedCount = 0
  let failedCount = 0

  for (const id of ids) {
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
      continue
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

      failedCount++
      continue
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

    deletedCount++
  }

  if (deletedCount === 0) {
    throw createError({
      statusCode: failedCount > 0 ? 409 : 404,
      statusMessage: failedCount > 0
        ? 'Failed to delete files from storage. Please try again.'
        : 'No files found',
    })
  }

  await invalidateStorageCache(userId)

  if (failedCount > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `Failed to delete ${failedCount} file(s) from storage`,
    })
  }

  return setResponseStatus(event, 204, 'Files deleted successfully')
})
