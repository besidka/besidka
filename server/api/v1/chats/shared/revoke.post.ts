import { and, eq, inArray } from 'drizzle-orm'
import { createError, useLogger } from 'evlog'
import * as schema from '~~/server/db/schema'

const bodyRules = z.object({
  chatIds: z.array(z.string().nonempty()).min(1).max(90),
})

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const body = await readValidatedBody(event, bodyRules.safeParse)

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

  logger.set({
    userId,
    chatIdsCount: body.data.chatIds.length,
  })

  const ownedChats = await db.query.chats.findMany({
    where: {
      userId,
      id: { in: body.data.chatIds },
    },
    columns: {
      id: true,
    },
  })

  if (ownedChats.length === 0) {
    return { count: 0 }
  }

  const ownedChatIds = ownedChats.map(chat => chat.id)

  const deletedShares = await db.delete(schema.chatShares)
    .where(inArray(schema.chatShares.chatId, ownedChatIds))
    .returning({ id: schema.chatShares.id })

  await db.update(schema.chats)
    .set({ shared: false })
    .where(and(
      eq(schema.chats.userId, userId),
      inArray(schema.chats.id, ownedChatIds),
    ))

  return { count: deletedShares.length }
})
