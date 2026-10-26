import { defineEventHandler } from 'nuxt/server'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'
import { resolveKnowledgeItem } from '~~/server/utils/knowledge/access'
import { getKnowledgeItemText } from '~~/server/utils/knowledge/text-store'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const access = await resolveKnowledgeItem(event)
  const { userId, projectId, projectPublicId, itemId, item } = access

  applyResponseHeaders(event, { 'Cache-Control': 'no-store' })

  const text = await getKnowledgeItemText({ userId, projectId, itemId })

  logger.set({
    userId,
    projectId: projectPublicId,
    attributes: {
      knowledge: {
        operation: 'text-read',
        itemId: item.id,
        textMissing: text === null && item.extractStatus === 'ready',
      },
    },
  })

  return { text: text ?? '' }
})
