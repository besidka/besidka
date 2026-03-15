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
  const activityAt = new Date()

  logger.set({ userId, projectId: params.data.id })

  const project = await db.query.projects.findFirst({
    where(projects, { and, eq }) {
      return and(
        eq(projects.id, params.data.id),
        eq(projects.userId, userId),
      )
    },
    columns: { id: true },
  })

  if (!project) {
    throw createError({
      message: 'Project not found',
      status: 404,
    })
  }

  await db.update(schema.chats)
    .set({
      projectId: sql`NULL`,
      activityAt,
    })
    .where(and(
      eq(schema.chats.projectId, project.id),
      eq(schema.chats.userId, userId),
    ))

  await db.delete(schema.projects)
    .where(and(
      eq(schema.projects.id, project.id),
      eq(schema.projects.userId, userId),
    ))

  return { success: true }
})
