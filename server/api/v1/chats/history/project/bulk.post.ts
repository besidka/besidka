import { createError } from 'evlog'
import { moveChatsToProject } from '~~/server/utils/chats/lifecycle'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

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
    where: {
      userId,
      id: { in: body.data.chatIds },
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

  if (body.data.projectId !== null) {
    const project = await db.query.projects.findFirst({
      where: {
        id: body.data.projectId!,
        userId,
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

    await moveChatsToProject(db, userId, chatsToMove, project)

    return { success: true }
  }

  await moveChatsToProject(db, userId, chatsToMove, null)

  return { success: true }
})
