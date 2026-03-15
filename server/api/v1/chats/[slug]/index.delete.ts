import { useLogger, createError } from 'evlog'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { refreshProjectActivityAt } from '~~/server/utils/projects/activity'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'

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
    where(chats, { and, eq }) {
      return and(
        eq(chats.slug, params.data.slug),
        eq(chats.userId, userId),
      )
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

  await db.delete(schema.chats)
    .where(and(
      eq(schema.chats.id, chat.id),
      eq(schema.chats.userId, userId),
    ))

  await refreshProjectActivityAt([chat.projectId], userId, db)
  await markProjectsMemoryStale([chat.projectId], userId, db)

  return { success: true }
})
