import { createError } from 'evlog'
import {
  defineEventHandler,
  readValidatedBody,
  setResponseStatus,
} from 'nuxt/server'
import {
  knowledgeItemsBatchCreateSchema,
} from '#shared/utils/project-knowledge-schemas'
import { resolveKnowledgeProject } from '~~/server/utils/knowledge/access'
import { ingestKnowledgeItems } from '~~/server/utils/knowledge/ingest'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const access = await resolveKnowledgeProject(event)
  const body = await readValidatedBody(
    event,
    knowledgeItemsBatchCreateSchema.safeParse,
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
