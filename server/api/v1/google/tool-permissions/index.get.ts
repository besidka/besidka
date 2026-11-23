import { defineEventHandler } from 'nuxt/server'
import { loadGoogleToolPermissionModes } from '~~/server/utils/google/tool-permissions'
import {
  requireGoogleToolPermissionsAccess,
  toGoogleToolPermissionEntries,
} from '~~/server/utils/google/tool-permissions-route'

/**
 * The Google tools the signed-in user may reach, each with the user's mode
 * for it: "blocked", or "ask" (the default, with no stored row). There is no
 * Always allow for a Google tool.
 */
export default defineEventHandler(async (event) => {
  const { userId, reachable } = await requireGoogleToolPermissionsAccess(
    event,
    { write: false },
  )

  return {
    tools: toGoogleToolPermissionEntries(
      reachable,
      await loadGoogleToolPermissionModes(userId),
    ),
  }
})
