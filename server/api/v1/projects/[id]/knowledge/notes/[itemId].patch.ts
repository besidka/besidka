import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import {
  knowledgeNoteUpdateSchema,
} from '#shared/utils/project-knowledge-schemas'
import {
  KNOWLEDGE_BODY_LIMITS,
  readCappedJsonBody,
} from '~~/server/utils/knowledge/body'
import { resolveKnowledgeItem } from '~~/server/utils/knowledge/access'
import { updateKnowledgeNote } from '~~/server/utils/knowledge/ingest'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const access = await resolveKnowledgeItem(event, { isMutation: true })
  const body = await readCappedJsonBody(
    event,
    knowledgeNoteUpdateSchema,
    KNOWLEDGE_BODY_LIMITS.note,
  )

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
      fix: 'Send at least one of title, body or description',
    })
  }

  const { userId, projectId, projectPublicId, item } = access

  logger.set({
    userId,
    projectId: projectPublicId,
    attributes: { knowledge: { itemId: item.id } },
  })

  return await updateKnowledgeNote(
    { userId, projectId, logger },
    item,
    body.data,
  )
})
