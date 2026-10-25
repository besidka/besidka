import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import {
  knowledgeCommitSchema,
} from '#shared/utils/project-knowledge-schemas'
import { resolveKnowledgeProject } from '~~/server/utils/knowledge/access'
import {
  findKnowledgeRemovalTargets,
  removeKnowledgeItems,
} from '~~/server/utils/knowledge/ingest'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const access = await resolveKnowledgeProject(event)
  const body = await readValidatedBody(event, knowledgeCommitSchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
      fix: 'Send an optional folder id and a list of item ids to remove',
    })
  }

  const { userId, projectId, projectPublicId } = access
  const context = { userId, projectId, logger }
  const { targets, skipped } = await findKnowledgeRemovalTargets(context, {
    remove: body.data.remove ?? [],
    folderId: body.data.folderId ?? null,
  })

  logger.set({
    userId,
    projectId: projectPublicId,
    attributes: {
      knowledge: {
        operation: 'commit',
        requested: body.data.remove?.length ?? 0,
        matched: targets.length,
        skipped: skipped.length,
        folderSync: Boolean(body.data.folderId),
      },
    },
  })

  const result = await removeKnowledgeItems(context, targets)

  return {
    version: result.version,
    packVersion: result.packVersion,
    removed: result.removed,
    skipped,
  }
})
