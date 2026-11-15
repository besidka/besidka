import { defineEventHandler } from 'nuxt/server'
import { toConnectorSummary } from '~~/server/utils/connectors/chat-selection'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import { listConnectors } from '~~/server/utils/connectors/store'

/**
 * The account's connectors as safe summaries (no URL path, no credentials,
 * no error text), for the chat composer's connector picker.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event, {
    write: false,
    rateLimit: false,
  })
  const connectors = await listConnectors(useDb(), userId)

  return { connectors: connectors.map(toConnectorSummary) }
})
