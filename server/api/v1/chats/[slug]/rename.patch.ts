import { useLogger, createError } from 'evlog'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { refreshProjectActivityAt } from '~~/server/utils/projects/activity'

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

  const body = await readValidatedBody(event, z.object({
    title: z.string().trim().min(1).max(200),
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

  logger.set({
    userId,
    chatSlug: params.data.slug,
    titleLength: body.data.title.length,
  })

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

  const activityAt = new Date()

  await db.update(schema.chats)
    .set({
      title: body.data.title,
      activityAt,
    })
    .where(and(
      eq(schema.chats.id, chat.id),
      eq(schema.chats.userId, userId),
    ))

  if (chat.projectId) {
    await refreshProjectActivityAt([chat.projectId], userId, db)
  }

  return { title: body.data.title }
})
