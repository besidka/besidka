import { defineEventHandler } from 'nuxt/server'
import { loadGoogleToolPermissionModes } from '~~/server/utils/google/tool-permissions'
import {
  requireGoogleToolPermissionsAccess,
  toGoogleToolPermissionEntries,
} from '~~/server/utils/google/tool-permissions-route'

/**
 * The Google tools the signed-in user may reach, each with the user's mode
 * for it: "blocked", "ask" (the default, with no stored row) or "allow"
 * (Always allow, only for a tool that can be always allowed, which each entry
 * says with `alwaysAllowable`).
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
