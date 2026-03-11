import { and, eq, inArray, sql } from 'drizzle-orm'
import { useLogger, createError } from 'evlog'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const body = await readValidatedBody(event, z.object({
    chatIds: z.array(z.string().nonempty()).min(1).max(100),
    folderId: z.string().nonempty().nullable(),
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
    chatCount: body.data.chatIds.length,
    folderId: body.data.folderId,
  })

  if (body.data.folderId !== null) {
    const folder = await db.query.folders.findFirst({
      where(folders, { and, eq }) {
        return and(
          eq(folders.id, body.data.folderId!),
          eq(folders.userId, userId),
        )
      },
      columns: { id: true },
    })

    if (!folder) {
      throw createError({
        message: 'Folder not found',
        status: 403,
        why: 'Folder does not exist or does not belong to user',
      })
    }

    await db.update(schema.chats)
      .set({ folderId: folder.id, activityAt: new Date() })
      .where(and(
        eq(schema.chats.userId, userId),
        inArray(schema.chats.id, body.data.chatIds),
      ))

    await db.update(schema.folders)
      .set({ activityAt: new Date() })
      .where(eq(schema.folders.id, folder.id))

    return { success: true }
  }

  await db.update(schema.chats)
    .set({ folderId: sql`NULL`, activityAt: new Date() })
    .where(and(
      eq(schema.chats.userId, userId),
      inArray(schema.chats.id, body.data.chatIds),
    ))

  return { success: true }
})
