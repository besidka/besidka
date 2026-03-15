import { useLogger, createError } from 'evlog'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { refreshProjectActivityAt } from '~~/server/utils/projects/activity'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const body = await readValidatedBody(event, z.object({
    chatId: z.string().nonempty(),
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

  logger.set({ userId, chatId: body.data.chatId })

  const chat = await db.query.chats.findFirst({
    where(chats, { and, eq }) {
      return and(
        eq(chats.id, body.data.chatId),
        eq(chats.userId, userId),
      )
    },
    columns: {
      id: true,
      projectId: true,
      pinnedAt: true,
    },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found',
      status: 404,
    })
  }

  const newPinnedAt = chat.pinnedAt ? null : new Date()

  await db.update(schema.chats)
    .set({ pinnedAt: newPinnedAt, activityAt: new Date() })
    .where(eq(schema.chats.id, chat.id))

  if (chat.projectId) {
    await refreshProjectActivityAt([chat.projectId], userId, db)
  }

  return { pinnedAt: newPinnedAt }
})
