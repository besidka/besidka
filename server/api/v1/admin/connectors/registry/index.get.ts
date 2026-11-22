import { defineEventHandler } from 'nuxt/server'
import { readRegistrySyncStatus } from '~~/server/utils/connectors/registry-sync-now'
import { requireAdmin } from '~~/server/utils/features/guards'

/**
 * What the admin's directory header shows: how many entries the registry
 * copy holds, when it last synced and whether a Sync now is running.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  event.res.headers.set('Cache-Control', 'private, no-store')

  return await readRegistrySyncStatus(useDb(), useKV())
})
