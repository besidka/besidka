import { and, eq, sql } from 'drizzle-orm'
import { useLogger, createError } from 'evlog'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const params = await getValidatedRouterParams(event, z.object({
    id: z.string().nonempty(),
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

  logger.set({ userId, folderId: params.data.id })

  const folder = await db.query.folders.findFirst({
    where(folders, { and, eq }) {
      return and(
        eq(folders.id, params.data.id),
        eq(folders.userId, userId),
      )
    },
    columns: { id: true },
  })

  if (!folder) {
    throw createError({
      message: 'Folder not found',
      status: 404,
    })
  }

  await db.update(schema.chats)
    .set({ folderId: sql`NULL` })
    .where(and(
      eq(schema.chats.folderId, folder.id),
      eq(schema.chats.userId, userId),
    ))

  await db.delete(schema.folders)
    .where(and(
      eq(schema.folders.id, folder.id),
      eq(schema.folders.userId, userId),
    ))

  return { success: true }
})
