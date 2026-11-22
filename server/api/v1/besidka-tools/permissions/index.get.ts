import { defineEventHandler } from 'nuxt/server'
import { listBesidkaToolPermissions } from '~~/server/utils/besidka-tools/permissions'
import { requireBesidkaToolsAccess } from '~~/server/utils/besidka-tools/route'

/**
 * Every Besidka tool a chat can offer the model, with its tier and the
 * signed-in user's permission mode for it (default "ask").
 */
export default defineEventHandler(async (event) => {
  const userId = await requireBesidkaToolsAccess(event, { write: false })

  return { tools: await listBesidkaToolPermissions(userId) }
})
