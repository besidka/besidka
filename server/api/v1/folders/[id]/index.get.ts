import { useLogger, createError } from 'evlog'

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
    columns: {
      id: true,
      name: true,
      pinnedAt: true,
      archivedAt: true,
      activityAt: true,
      createdAt: true,
    },
  })

  if (!folder) {
    throw createError({
      message: 'Folder not found',
      status: 404,
    })
  }

  return folder
})
