import { and, eq, inArray, sql } from 'drizzle-orm'
import { useLogger, createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { refreshProjectActivityAt } from '~~/server/utils/projects/activity'
import {
  markProjectsMemoryStale,
  refreshProjectMemory,
} from '~~/server/utils/projects/memory'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const body = await readValidatedBody(event, z.object({
    chatIds: z.array(z.string().nonempty()).min(1).max(100),
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
    chatCount: body.data.chatIds.length,
    projectId: body.data.projectId,
  })

  const chats = await db.query.chats.findMany({
    where(chats, { and, eq, inArray }) {
      return and(
        eq(chats.userId, userId),
        inArray(chats.id, body.data.chatIds),
      )
    },
    columns: {
      id: true,
      projectId: true,
    },
  })
  const chatsToMove = chats.filter((chat) => {
    return chat.projectId !== body.data.projectId
  })

  if (chatsToMove.length === 0) {
    return { success: true }
  }

  const movedChatIds = chatsToMove.map(chat => chat.id)
  const sourceProjectIds = chatsToMove.map(chat => chat.projectId)

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
        eq(schema.chats.userId, userId),
        inArray(schema.chats.id, movedChatIds),
      ))

    await db.update(schema.projects)
      .set({ activityAt })
      .where(eq(schema.projects.id, project.id))

    await refreshProjectActivityAt(sourceProjectIds, userId, db)
    await markProjectsMemoryStale(
      [...sourceProjectIds, project.id],
      userId,
      db,
    )

    try {
      await refreshProjectMemory(project.id, userId, db)
    } catch (exception) {
      logger.set({
        projectMemoryRefreshError:
          exception instanceof Error ? exception.message : String(exception),
      })
    }

    return { success: true }
  }

  const activityAt = new Date()

  await db.update(schema.chats)
    .set({ projectId: sql`NULL`, activityAt })
    .where(and(
      eq(schema.chats.userId, userId),
      inArray(schema.chats.id, movedChatIds),
    ))

  await refreshProjectActivityAt(sourceProjectIds, userId, db)
  await markProjectsMemoryStale(sourceProjectIds, userId, db)

  return { success: true }
})
