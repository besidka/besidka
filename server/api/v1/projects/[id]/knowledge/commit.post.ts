import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import {
  knowledgeCommitSchema,
} from '#shared/utils/project-knowledge-schemas'
import {
  KNOWLEDGE_BODY_LIMITS,
  readCappedJsonBody,
} from '~~/server/utils/knowledge/body'
import { resolveKnowledgeProject } from '~~/server/utils/knowledge/access'
import { commitKnowledgeRequest } from '~~/server/utils/knowledge/ingest'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const access = await resolveKnowledgeProject(event, { isMutation: true })
  const body = await readCappedJsonBody(
    event,
    knowledgeCommitSchema,
    KNOWLEDGE_BODY_LIMITS.small,
  )

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
      fix: 'Send an optional folder id and a list of item ids to remove',
    })
  }

  const { userId, projectId, projectPublicId } = access

  logger.set({ userId, projectId: projectPublicId })

  return await commitKnowledgeRequest(
    { userId, projectId, logger },
    {
      remove: body.data.remove ?? [],
      folderId: body.data.folderId ?? null,
    },
  )
})
