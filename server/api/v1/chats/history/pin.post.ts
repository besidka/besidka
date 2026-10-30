import { createError } from 'evlog'
import { setChatPinnedAt } from '~~/server/utils/chats/lifecycle'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
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
    where: {
      id: body.data.chatId,
      userId,
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

  await setChatPinnedAt(db, userId, chat, newPinnedAt)

  return { pinnedAt: newPinnedAt }
})
