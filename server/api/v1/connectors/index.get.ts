import { defineEventHandler } from 'nuxt/server'
import { listConnectorPageItems } from '~~/server/utils/connectors/page'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'

/**
 * The account's connectors as safe summaries (no URL, no credentials, no
 * upstream text, no hashes), for the Connectors page and the chat
 * composer's connector picker.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event, {
    write: false,
    rateLimit: false,
  })

  return { connectors: await listConnectorPageItems(useDb(), userId) }
})
