import { useLogger, createError } from 'evlog'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { refreshProjectActivityAt } from '~~/server/utils/projects/activity'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'
import {
  cleanupFilesOrphanedByChatDeletion,
  findChatOriginFiles,
} from '~~/server/utils/files/chat-deletion-cleanup'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { removeChatsFromSearchIndex } from '~~/server/utils/search/index-writer'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const params = await getValidatedRouterParams(event, z.object({
    slug: z.ulid(),
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

  logger.set({ userId, chatSlug: params.data.slug })

  const chat = await db.query.chats.findFirst({
    where: {
      slug: params.data.slug,
      userId,
    },
    columns: {
      id: true,
      projectId: true,
    },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found',
      status: 404,
    })
  }

  const originFiles = await findChatOriginFiles(chat.id, userId)

  await removeChatsFromSearchIndex({
    db,
    userId,
    chatIds: [chat.id],
    logger,
    stage: 'chat-delete',
  })

  await db.delete(schema.chats)
    .where(and(
      eq(schema.chats.id, chat.id),
      eq(schema.chats.userId, userId),
    ))

  await refreshProjectActivityAt([chat.projectId], userId, db)
  await markProjectsMemoryStale([chat.projectId], userId, db)

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
