import { useLogger, createError } from 'evlog'
import {
  and, eq, inArray, sql,
} from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  cleanupFilesOrphanedByChatDeletion,
  findMessageOriginFiles,
} from '~~/server/utils/files/chat-deletion-cleanup'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  removeMessageRowsFromSearchIndex,
  safeDecodePublicId,
} from '~~/server/utils/search/index-writer'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const params = await getValidatedRouterParams(event, z.object({
    slug: z.ulid(),
    id: z.string().min(1).max(64),
  }).safeParse)

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const userId = parseInt(session.user.id)

  logger.set({
    userId,
    chatSlug: params.data.slug,
    messageId: params.data.id,
  })

  const chat = await db.query.chats.findFirst({
    where: {
      slug: params.data.slug,
      userId,
    },
    columns: {
      id: true,
    },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found',
      status: 404,
    })
  }

  const message = await db.query.messages.findFirst({
    where: {
      chatId: chat.id,
      OR: [
        { publicId: params.data.id },
        { id: params.data.id },
      ],
    },
    columns: {
      id: true,
    },
  })

  if (!message) {
    throw createError({
      message: 'Message not found',
      status: 404,
    })
  }

  const messageRowId = safeDecodePublicId(message.id)
  const originFiles = messageRowId === null
    ? []
    : await findMessageOriginFiles(messageRowId, userId)

  const deleteResult = await db.delete(schema.messages)
    .where(and(
      eq(schema.messages.id, message.id),
      eq(schema.messages.chatId, chat.id),
      inArray(
        schema.messages.chatId,
        db.select({ chatId: schema.messages.chatId })
          .from(schema.messages)
          .where(eq(schema.messages.chatId, chat.id))
          .groupBy(schema.messages.chatId)
          .having(sql`count(*) > 1`),
      ),
    ))

  if (deleteResult.meta.changes < 1) {
    throw createError({
      message: 'Cannot delete the only message in a chat',
      status: 400,
      fix: 'Delete the chat instead',
    })
  }

  await removeMessageRowsFromSearchIndex({
    db,
    messageRowIds: messageRowId === null ? [] : [messageRowId],
    logger,
  })

  try {
    await cleanupFilesOrphanedByChatDeletion(originFiles, userId, logger)
  } catch (exception) {
    logger.set({
      orphanedFileCleanup: {
        phase: 'cleanup',
        candidateCount: originFiles.length,
      },
      attributes: {
        orphanedFileCleanup: {
          error: exceptionMessage(exception),
        },
      },
    })
  }

  return { success: true }
})
