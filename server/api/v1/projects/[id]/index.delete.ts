import { and, eq, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { defineEventHandler } from 'nuxt/server'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { getEffectiveRetentionDays } from '~~/server/utils/files/file-governance'
import {
  decodeKnowledgeProjectId,
  unlinkKnowledgeProjectFiles,
} from '~~/server/utils/knowledge/linked-files'
import { purgeProjectKnowledgeForProject } from '~~/server/utils/knowledge/purge'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

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
  const activityAt = new Date()

  logger.set({ userId, projectId: params.data.id })

  const project = await db.query.projects.findFirst({
    where: { id: params.data.id, userId },
    columns: { id: true },
  })

  const internalProjectId = project
    ? decodeKnowledgeProjectId(project.id)
    : null

  if (!project || internalProjectId === null) {
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

  const retentionDays = await getEffectiveRetentionDays(userId)

  await unlinkKnowledgeProjectFiles({
    userId,
    projectId: internalProjectId,
    retentionDays,
  })

  await db.delete(schema.projects)
    .where(and(
      eq(schema.projects.id, project.id),
      eq(schema.projects.userId, userId),
    ))

  try {
    const purgeResult = await purgeProjectKnowledgeForProject(
      userId,
      internalProjectId,
    )

    logger.set({
      knowledgePurge: {
        objectsDeleted: purgeResult.objectsDeleted,
        batches: purgeResult.batches,
      },
    })
  } catch (exception) {
    logger.set({
      knowledgePurge: {
        failed: true,
      },
      attributes: {
        knowledgePurge: {
          error: exceptionMessage(exception),
        },
      },
    })
  }

  await invalidateStorageCache(userId, logger)

  return { success: true }
})
