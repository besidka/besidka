import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { refreshFolderActivityAt } from '~~/server/utils/folders/activity'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    chatIds: z.array(z.string().nonempty()).min(1).max(90),
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
  const userId = parseInt(session.user.id)
  const chats = await db.query.chats.findMany({
    where(chats, { and, eq, inArray }) {
      return and(
        eq(chats.userId, userId),
        inArray(chats.id, body.data.chatIds),
      )
    },
    columns: {
      folderId: true,
    },
  })

  await db.delete(schema.chats)
    .where(and(
      eq(schema.chats.userId, userId),
      inArray(schema.chats.id, body.data.chatIds),
    ))

  await refreshFolderActivityAt(
    chats.map(chat => chat.folderId),
    userId,
    db,
  )

  return { success: true }
})
