import { createError } from 'evlog'
import { refreshProjectMemory } from '~~/server/utils/projects/memory'
import { defineEventHandler, getRouterParams } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const params = z.object({
    slug: z.ulid(),
  }).safeParse(getRouterParams(event, { decode: true }))

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
  const chat = await db.query.chats.findFirst({
    where: {
      slug: params.data.slug,
      userId,
    },
    columns: {
      projectId: true,
    },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found',
      status: 404,
    })
  }

  logger.set({
    userId,
    slug: params.data.slug,
    projectId: chat.projectId,
  })

  if (!chat.projectId) {
    return {
      memoryStatus: 'idle',
      memory: null,
      memoryProvider: null,
      memoryModel: null,
    }
  }

  return await refreshProjectMemory(chat.projectId, userId, db)
})
