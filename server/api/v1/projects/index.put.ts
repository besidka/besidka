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

  const project = await db
    .insert(schema.projects)
    .values({
      userId,
      name: body.data.name,
    })
    .returning({
      id: schema.projects.id,
      name: schema.projects.name,
      instructions: schema.projects.instructions,
      memory: schema.projects.memory,
      memoryStatus: schema.projects.memoryStatus,
      memoryUpdatedAt: schema.projects.memoryUpdatedAt,
      memoryDirtyAt: schema.projects.memoryDirtyAt,
      memoryProvider: schema.projects.memoryProvider,
      memoryModel: schema.projects.memoryModel,
      memoryError: schema.projects.memoryError,
      activityAt: schema.projects.activityAt,
      createdAt: schema.projects.createdAt,
      pinnedAt: schema.projects.pinnedAt,
      archivedAt: schema.projects.archivedAt,
    })
    .get()

  return project
})
