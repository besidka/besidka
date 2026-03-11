import { and, eq } from 'drizzle-orm'
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
    columns: { id: true, pinnedAt: true },
  })

  if (!folder) {
    throw createError({
      message: 'Folder not found',
      status: 404,
    })
  }

  const newPinnedAt = folder.pinnedAt ? null : new Date()

  await db.update(schema.folders)
    .set({ pinnedAt: newPinnedAt, updatedAt: new Date() })
    .where(and(
      eq(schema.folders.id, folder.id),
      eq(schema.folders.userId, userId),
    ))

  return { pinnedAt: newPinnedAt }
})
