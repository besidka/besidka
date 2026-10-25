import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { resolveLegacyProjectMemory } from '~~/server/utils/projects/legacy-memory'
import { resolveProjectMemoryDisplayStatus } from '~~/server/utils/projects/memory'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  const params = z.object({
    id: z.string().nonempty(),
  }).safeParse(getDecodedRouterParams(event))

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
    where: { id: params.data.id, userId },
    columns: {
      id: true,
      name: true,
      instructions: true,
      memory: true,
      memoryStatus: true,
      memoryUpdatedAt: true,
      memoryDirtyAt: true,
      memoryProvider: true,
      memoryModel: true,
      memoryError: true,
      memoryMigratedAt: true,
      pinnedAt: true,
      archivedAt: true,
      activityAt: true,
      createdAt: true,
    },
  })

  if (!project) {
    throw createError({
      message: 'Project not found',
      status: 404,
    })
  }

  const { memoryMigratedAt, ...projectFields } = project

  return {
    ...projectFields,
    memory: await resolveLegacyProjectMemory(
      { id: project.id, memory: project.memory, memoryMigratedAt },
      userId,
      db,
      logger,
    ),
    memoryStatus: await resolveProjectMemoryDisplayStatus(
      project.memoryStatus,
      project.id,
      logger,
    ),
  }
})
