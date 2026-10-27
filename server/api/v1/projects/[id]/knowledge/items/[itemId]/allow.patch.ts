import { defineEventHandler } from 'nuxt/server'
import { resolveKnowledgeItem } from '~~/server/utils/knowledge/access'
import {
  allowFlaggedKnowledgeItem,
} from '~~/server/utils/knowledge/ingest'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { requireLegalConsent } from '~~/server/utils/legal/consent'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const access = await resolveKnowledgeItem(event, { isMutation: true })
  const { userId, projectId, projectPublicId, item } = access

  await requireLegalConsent(userId)

  logger.set({
    userId,
    projectId: projectPublicId,
    attributes: { knowledge: { itemId: item.id } },
  })

  return await allowFlaggedKnowledgeItem(
    { userId, projectId, logger },
    item,
  )
})
