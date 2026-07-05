import { and, eq } from 'drizzle-orm'
import { createError, useLogger } from 'evlog'
import * as schema from '~~/server/db/schema'

const paramsRules = z.object({
  slug: z.ulid(),
})

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const params = await getValidatedRouterParams(
    event,
    paramsRules.safeParse,
  )

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
    },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found',
      status: 404,
    })
  }

  const deletedShares = await db.delete(schema.chatShares)
    .where(eq(schema.chatShares.chatId, chat.id))
    .returning({ id: schema.chatShares.id })

  await db.update(schema.chats)
    .set({ shared: false })
    .where(and(
      eq(schema.chats.id, chat.id),
      eq(schema.chats.userId, userId),
    ))

  logger.set({ revokedCount: deletedShares.length })

  return { ok: true }
})
