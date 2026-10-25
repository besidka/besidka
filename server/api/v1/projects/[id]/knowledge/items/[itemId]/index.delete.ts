import { defineEventHandler } from 'nuxt/server'
import { resolveKnowledgeItem } from '~~/server/utils/knowledge/access'
import { removeKnowledgeItems } from '~~/server/utils/knowledge/ingest'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const access = await resolveKnowledgeItem(event)
  const { userId, projectId, projectPublicId, itemId, item } = access

  logger.set({
    userId,
    projectId: projectPublicId,
    attributes: { knowledge: { itemId: item.id } },
  })

  const result = await removeKnowledgeItems(
    { userId, projectId, logger },
    [{ itemId, fileId: item.fileId }],
  )

  return { version: result.version, packVersion: result.packVersion }
})
