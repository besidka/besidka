import { defineEventHandler } from 'nuxt/server'
import { listMemoryToolPermissions } from '~~/server/utils/memory/tools/permissions'
import { requireMemoryToolPermissionsAccess } from '~~/server/utils/memory/tools/permissions-route'

/**
 * The signed-in user's permission mode for `memory_write` and
 * `memory_forget` (default "ask"). Reading memory has no setting: it never
 * asks.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireMemoryToolPermissionsAccess(event, {
    write: false,
  })

  return { tools: await listMemoryToolPermissions(userId) }
})
