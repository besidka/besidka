import { createError } from 'evlog'
import { moveChatsToProject } from '~~/server/utils/chats/lifecycle'
import {
  defineEventHandler,
  readValidatedBody,
} from 'nuxt/server'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const params = z.object({
    slug: z.ulid(),
  }).safeParse(getDecodedRouterParams(event))

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
    where: {
      slug: params.data.slug,
      userId,
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

    await moveChatsToProject(db, userId, [chat], project)

    return { projectId: project.id }
  }

  await moveChatsToProject(db, userId, [chat], null)

  return { projectId: null }
})
