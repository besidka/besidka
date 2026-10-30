import { and, eq, inArray, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  cleanupFilesOrphanedByChatDeletion,
  findChatOriginFiles,
  findMessageOriginFiles,
} from '~~/server/utils/files/chat-deletion-cleanup'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { detachChatsFromMemory } from '~~/server/utils/memory/chat-deletion'
import { refreshProjectActivityAt } from '~~/server/utils/projects/activity'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'
import {
  removeChatsFromSearchIndex,
  removeMessageRowsFromSearchIndex,
  safeDecodePublicId,
} from '~~/server/utils/search/index-writer'

type DbClient = ReturnType<typeof useDb>

const MAX_BATCH_QUERY_PARAMS = 90

export interface OwnedChatRef {
  id: string
  projectId: string | null
}

export interface ChatMemoryExclusionOptions {
  forwardOnly?: boolean
}

export interface ChatMoveTarget {
  id: string
}

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = []

  for (let offset = 0; offset < ids.length; offset += MAX_BATCH_QUERY_PARAMS) {
    chunks.push(ids.slice(offset, offset + MAX_BATCH_QUERY_PARAMS))
  }

  return chunks
}

/**
 * Sets the title of an owned chat and bumps its activity time, like the
 * rename route. The caller has already resolved the chat for this user and
 * trimmed and validated the title.
 */
export async function renameChat(
  db: DbClient,
  userId: number,
  chat: OwnedChatRef,
  title: string,
): Promise<void> {
  await db.update(schema.chats)
    .set({
      title,
      activityAt: new Date(),
    })
    .where(and(
      eq(schema.chats.id, chat.id),
      eq(schema.chats.userId, userId),
    ))

  if (chat.projectId) {
    await refreshProjectActivityAt([chat.projectId], userId, db)
  }
}

/**
 * Writes the pinned time of an owned chat (null unpins) and bumps its
 * activity time. The web route flips the current state, the MCP tool sets
 * it, so deciding the new value is the caller's job.
 */
export async function setChatPinnedAt(
  db: DbClient,
  userId: number,
  chat: OwnedChatRef,
  pinnedAt: Date | null,
): Promise<void> {
  await db.update(schema.chats)
    .set({ pinnedAt, activityAt: new Date() })
    .where(and(
      eq(schema.chats.id, chat.id),
      eq(schema.chats.userId, userId),
    ))

  if (chat.projectId) {
    await refreshProjectActivityAt([chat.projectId], userId, db)
  }
}

/**
 * Moves owned chats into a project, or out of any project when `project` is
 * null. The caller has already resolved the chats for this user, dropped the
 * ones already in the target and verified the project belongs to the user.
 * Every source project gets its activity time recomputed and, with the
 * target, its memory marked stale. When the target project has automatic
 * updates set to `on` itself, the moved chats are stamped as already
 * summarized, so the background sweep reads only messages written after the
 * move and never spends the user's key on what was written under another
 * scope.
 */
export async function moveChatsToProject(
  db: DbClient,
  userId: number,
  chats: OwnedChatRef[],
  project: ChatMoveTarget | null,
): Promise<void> {
  const activityAt = new Date()
  const sourceProjectIds = chats.map((chat) => {
    return chat.projectId
  })
  const targetProject = project
    ? await db.query.projects.findFirst({
      where: { id: project.id, userId },
      columns: { memoryAutoUpdate: true },
    })
    : undefined
  const forwardStamp = targetProject?.memoryAutoUpdate === 'on'
    ? { projectMemorySummaryUpdatedAt: activityAt }
    : {}

  for (const chunk of chunkIds(chats.map(chat => chat.id))) {
    await db.update(schema.chats)
      .set({
        projectId: project ? project.id : sql`NULL`,
        activityAt,
        ...forwardStamp,
      })
      .where(and(
        eq(schema.chats.userId, userId),
        inArray(schema.chats.id, chunk),
      ))
  }

  if (project) {
    await db.update(schema.projects)
      .set({ activityAt })
      .where(eq(schema.projects.id, project.id))
  }

  await refreshProjectActivityAt(sourceProjectIds, userId, db)
  await markProjectsMemoryStale(
    project ? [...sourceProjectIds, project.id] : sourceProjectIds,
    userId,
    db,
  )
}

/**
 * Sets whether the chat is excluded from memory. The flag is written first,
 * so no new extraction picks the chat, and turning it on then removes the
 * chat from memory provenance like a chat deletion does; a failed cascade
 * fails the call and is safe to retry. The activity time is not touched, so
 * toggling never makes a chat due for extraction. With `forwardOnly`,
 * allowing a chat again stamps its extraction times in the same write, so
 * the background sweep reads only what is written from now on and never
 * spends the user's key on messages from while it was excluded.
 */
export async function setChatMemoryExclusion(
  db: DbClient,
  userId: number,
  chatSlug: string,
  isExcluded: boolean,
  logger: LoggerLike,
  options: ChatMemoryExclusionOptions = {},
): Promise<OwnedChatRef> {
  const forwardStamp = options.forwardOnly && !isExcluded
    ? {
      memoryExtractedAt: new Date(),
      projectMemorySummaryUpdatedAt: new Date(),
    }
    : {}
  const chat = await db.update(schema.chats)
    .set({ memoryExcluded: isExcluded, ...forwardStamp })
    .where(and(
      eq(schema.chats.slug, chatSlug),
      eq(schema.chats.userId, userId),
    ))
    .returning({
      id: schema.chats.id,
      projectId: schema.chats.projectId,
    })
    .get()

  if (!chat) {
    throw createError({
      message: 'Chat not found',
      status: 404,
    })
  }

  if (isExcluded) {
    await detachChatsFromMemory({
      db,
      userId,
      chatIds: [chat.id],
      logger,
    })
    await markProjectsMemoryStale([chat.projectId], userId, db)
  }

  return chat
}

/**
 * Hard-deletes one owned chat: memory provenance and the search index first
 * (both need the chat rows), then the chat with its messages, then the
 * project bookkeeping and the files that only this chat produced. The file
 * cleanup is best effort and never fails the delete.
 */
export async function deleteChat(
  db: DbClient,
  userId: number,
  chat: OwnedChatRef,
  logger: LoggerLike,
): Promise<void> {
  const originFiles = await findChatOriginFiles(chat.id, userId)

  await detachChatsFromMemory({
    db,
    userId,
    chatIds: [chat.id],
    logger,
  })

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
}

/**
 * Deletes one message of an owned chat. `messageId` is the message public
 * id or its internal id. The last remaining message of a chat is refused,
 * the chat itself has to be deleted instead.
 */
export async function deleteChatMessage(
  db: DbClient,
  userId: number,
  chatId: string,
  messageId: string,
  logger: LoggerLike,
): Promise<void> {
  const message = await db.query.messages.findFirst({
    where: {
      chatId,
      OR: [
        { publicId: messageId },
        { id: messageId },
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
      eq(schema.messages.chatId, chatId),
      inArray(
        schema.messages.chatId,
        db.select({ chatId: schema.messages.chatId })
          .from(schema.messages)
          .where(eq(schema.messages.chatId, chatId))
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
}
