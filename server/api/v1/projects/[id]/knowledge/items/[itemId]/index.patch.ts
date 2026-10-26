import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import {
  knowledgeItemPatchSchema,
} from '#shared/utils/project-knowledge-schemas'
import {
  KNOWLEDGE_BODY_LIMITS,
  readCappedJsonBody,
} from '~~/server/utils/knowledge/body'
import { resolveKnowledgeItem } from '~~/server/utils/knowledge/access'
import {
  updateKnowledgeItemMetadata,
} from '~~/server/utils/knowledge/ingest'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { requireLegalConsent } from '~~/server/utils/legal/consent'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const access = await resolveKnowledgeItem(event, { isMutation: true })
  const body = await readCappedJsonBody(
    event,
    knowledgeItemPatchSchema,
    KNOWLEDGE_BODY_LIMITS.small,
  )

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
      fix: 'Send a description, pinned or sendAsNativePdf value',
    })
  }

  const { userId, projectId, projectPublicId, item } = access

  await requireLegalConsent(userId)

  logger.set({
    userId,
    projectId: projectPublicId,
    attributes: { knowledge: { itemId: item.id } },
  })

  return await updateKnowledgeItemMetadata(
    { userId, projectId, logger },
    item,
    body.data,
  )
})
