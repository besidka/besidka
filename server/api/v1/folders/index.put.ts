import { useLogger, createError } from 'evlog'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const body = await readValidatedBody(event, z.object({
    name: z.string().trim().min(1).max(100),
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

  logger.set({ userId, name: body.data.name })

  const folder = await db
    .insert(schema.folders)
    .values({
      userId,
      name: body.data.name,
    })
    .returning({
      id: schema.folders.id,
      name: schema.folders.name,
      activityAt: schema.folders.activityAt,
      createdAt: schema.folders.createdAt,
      pinnedAt: schema.folders.pinnedAt,
      archivedAt: schema.folders.archivedAt,
    })
    .get()

  return folder
})
