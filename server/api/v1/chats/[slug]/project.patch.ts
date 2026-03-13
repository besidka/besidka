import { and, eq, sql } from 'drizzle-orm'
import { useLogger, createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { refreshProjectActivityAt } from '~~/server/utils/projects/activity'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const params = await getValidatedRouterParams(event, z.object({
    slug: z.ulid(),
  }).safeParse)

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const body = await readValidatedBody(event, z.object({
    projectId: z.string().nonempty().nullable(),
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
    slug: params.data.slug,
    projectId: body.data.projectId,
  })

  const chat = await db.query.chats.findFirst({
    where(chats, { and, eq }) {
      return and(
        eq(chats.slug, params.data.slug),
        eq(chats.userId, userId),
      )
    },
    columns: { id: true, projectId: true },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found',
      status: 404,
    })
  }

  if (body.data.projectId === chat.projectId) {
    return { projectId: chat.projectId }
  }

  if (body.data.projectId !== null) {
    const project = await db.query.projects.findFirst({
      where(projects, { and, eq }) {
        return and(
          eq(projects.id, body.data.projectId!),
          eq(projects.userId, userId),
        )
      },
      columns: { id: true },
    })

    if (!project) {
      throw createError({
        message: 'Project not found',
        status: 403,
        why: 'Project does not exist or does not belong to user',
      })
    }

    const activityAt = new Date()

    await db.update(schema.chats)
      .set({ projectId: project.id, activityAt })
      .where(and(
        eq(schema.chats.id, chat.id),
        eq(schema.chats.userId, userId),
      ))

    await db.update(schema.projects)
      .set({ activityAt })
      .where(eq(schema.projects.id, project.id))

    if (chat.projectId && chat.projectId !== project.id) {
      await refreshProjectActivityAt([chat.projectId], userId, db)
    }

    await markProjectsMemoryStale([chat.projectId, project.id], userId, db)

    return { projectId: project.id }
  }

  const activityAt = new Date()

  await db.update(schema.chats)
    .set({ projectId: sql`NULL`, activityAt })
    .where(and(
      eq(schema.chats.id, chat.id),
      eq(schema.chats.userId, userId),
    ))

  if (chat.projectId) {
    await refreshProjectActivityAt([chat.projectId], userId, db)
  }

  await markProjectsMemoryStale([chat.projectId], userId, db)

  return { projectId: null }
})
