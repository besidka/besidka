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

  logger.set({ userId, projectId: params.data.id })

  const project = await db.query.projects.findFirst({
    where(projects, { and, eq }) {
      return and(
        eq(projects.id, params.data.id),
        eq(projects.userId, userId),
      )
    },
    columns: { id: true, archivedAt: true },
  })

  if (!project) {
    throw createError({
      message: 'Project not found',
      status: 404,
    })
  }

  const newArchivedAt = project.archivedAt ? null : new Date()

  await db.update(schema.projects)
    .set({ archivedAt: newArchivedAt, updatedAt: new Date() })
    .where(and(
      eq(schema.projects.id, project.id),
      eq(schema.projects.userId, userId),
    ))

  return { archivedAt: newArchivedAt }
})
