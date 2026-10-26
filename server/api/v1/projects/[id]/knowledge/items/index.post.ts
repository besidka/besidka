import { createError } from 'evlog'
import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import {
  knowledgeItemsBatchCreateSchema,
} from '#shared/utils/project-knowledge-schemas'
import {
  KNOWLEDGE_BODY_LIMITS,
  readCappedJsonBody,
} from '~~/server/utils/knowledge/body'
import { resolveKnowledgeProject } from '~~/server/utils/knowledge/access'
import { ingestKnowledgeItems } from '~~/server/utils/knowledge/ingest'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { requireLegalConsent } from '~~/server/utils/legal/consent'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const access = await resolveKnowledgeProject(event, { isMutation: true })
  const body = await readCappedJsonBody(
    event,
    knowledgeItemsBatchCreateSchema,
    KNOWLEDGE_BODY_LIMITS.itemsBatch,
  )

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
      fix: 'Send up to 25 items, at most 1 MB of text in total',
    })
  }

  const { userId, projectId, projectPublicId } = access

  await requireLegalConsent(userId)

  logger.set({
    userId,
    projectId: projectPublicId,
    attributes: {
      knowledge: {
        operation: 'items-create',
        requested: body.data.items.length,
      },
    },
  })

  const result = await ingestKnowledgeItems(
    { userId, projectId, logger },
    body.data,
  )

  if (result.items.length > 0) {
    setResponseStatus(event, 201)
  }

  return result
})
