import { createError } from 'evlog'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { detachChatsFromMemory } from '~~/server/utils/memory/chat-deletion'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'
import {
  defineEventHandler,
  readValidatedBody,
} from 'nuxt/server'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * PATCH /chats/:slug/memory
 *
 * Sets whether the chat is excluded from memory. The flag is written first,
 * so no new extraction picks the chat, and turning it on then removes the
 * chat from memory provenance like a chat deletion does; a failed cascade
 * fails the request and is safe to retry. The activity time is not touched,
 * so toggling never makes a chat due for extraction.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const params = z.object({
    slug: z.ulid(),
  }).safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const body = await readValidatedBody(event, z.object({
    excluded: z.boolean(),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const userId = parseInt(session.user.id)
  const isExcluded = body.data.excluded

  logger.set({
    userId,
    chatSlug: params.data.slug,
    attributes: {
      memoryChatExclusion: { excluded: isExcluded },
    },
  })

  const chat = await db.update(schema.chats)
    .set({ memoryExcluded: isExcluded })
    .where(and(
      eq(schema.chats.slug, params.data.slug),
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

  return { memoryExcluded: isExcluded }
})
