import { useLogger, createError } from 'evlog'
import { refreshProjectMemory } from '~~/server/utils/projects/memory'

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
  const chat = await db.query.chats.findFirst({
    where(chats, { and, eq }) {
      return and(
        eq(chats.slug, params.data.slug),
        eq(chats.userId, userId),
      )
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
