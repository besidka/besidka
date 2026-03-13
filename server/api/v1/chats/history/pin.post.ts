import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { refreshProjectActivityAt } from '~~/server/utils/projects/activity'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    chatId: z.string().nonempty(),
  }).safeParse)

  if (body.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: body.error,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()

  const chat = await db.query.chats.findFirst({
    where(chats, { and, eq }) {
      return and(
        eq(chats.id, body.data.chatId),
        eq(chats.userId, parseInt(session.user.id)),
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
      statusCode: 404,
      statusMessage: 'Chat not found.',
    })
  }

  const userId = parseInt(session.user.id)
  const newPinnedAt = chat.pinnedAt ? null : new Date()

  await db.update(schema.chats)
    .set({ pinnedAt: newPinnedAt, activityAt: new Date() })
    .where(eq(schema.chats.id, chat.id))

  if (chat.projectId) {
    await refreshProjectActivityAt([chat.projectId], userId, db)
  }

  return { pinnedAt: newPinnedAt }
})
