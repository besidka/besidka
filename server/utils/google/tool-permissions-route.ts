import type { RequestEvent } from 'nuxt/server'
import { GOOGLE_BYO_FEATURE_FLAG } from '#shared/utils/google-byo'
import { GOOGLE_TOOL_CATALOG } from '#shared/utils/google-tool-catalog'
import type {
  GoogleService,
  GoogleToolCatalogEntry,
  GoogleToolPermissionMode,
} from '#shared/utils/google-tool-catalog'
import { createFeatureUnavailableError } from '~~/server/utils/features/guards'
import { checkGoogleByoAccess } from '~~/server/utils/google/byo-access'
import {
  GOOGLE_FEATURE_FLAG,
  isGoogleFeatureActive,
  requireGoogleAccess,
} from '~~/server/utils/google/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { pickGoogleToolPermissionMode } from '~~/server/utils/google/tool-permissions'
import type { GoogleToolPermissionModes } from '~~/server/utils/google/tool-permissions'

export interface GoogleToolPermissionEntry {
  name: string
  service: GoogleService
  mode: GoogleToolPermissionMode
}

/**
 * The catalog tools this user may reach, by the same flags that offer them
 * in a chat: the Drive tools of Besidka's client need `google.drive` active,
 * every tool of the owner's own client needs the admin gate with
 * `google.byo` (and `google.gmail` or `google.calendar` for those services).
 * A user who reaches none gets the 404 of an unavailable feature, so a
 * setting for a tool they cannot use is never stored or shown.
 */
export async function listReachableGoogleTools(
  event: RequestEvent,
  userId: number,
): Promise<GoogleToolCatalogEntry[]> {
  const logger = useRequestLogger(event)
  const reachableFlags = new Set<string>()

  if (await isGoogleFeatureActive(event)) {
    reachableFlags.add(GOOGLE_FEATURE_FLAG)
  }

  const db = useDb()
  const byoVerdict = await checkGoogleByoAccess({ db, userId, logger })

  if (byoVerdict === 'allowed') {
    reachableFlags.add(GOOGLE_BYO_FEATURE_FLAG)

    const byoFlags = new Set(
      GOOGLE_TOOL_CATALOG
        .filter(tool => tool.client === 'byo')
        .map(tool => tool.flag)
        .filter(flag => flag !== GOOGLE_BYO_FEATURE_FLAG),
    )

    for (const flag of byoFlags) {
      const verdict = await checkGoogleByoAccess({
        db,
        userId,
        logger,
        requiredFlags: [flag],
      })

      if (verdict === 'allowed') {
        reachableFlags.add(flag)
      }
    }
  }

  return GOOGLE_TOOL_CATALOG.filter((tool) => {
    return reachableFlags.has(tool.flag)
  })
}

export function toGoogleToolPermissionEntries(
  tools: readonly GoogleToolCatalogEntry[],
  modes: GoogleToolPermissionModes,
): GoogleToolPermissionEntry[] {
  return tools.map((tool) => {
    return {
      name: tool.name,
      service: tool.service,
      mode: pickGoogleToolPermissionMode(tool.name, modes),
    }
  })
}

/**
 * The gate of the Google tool permission routes, in this order: the
 * same-origin guard (the write guard for a `PUT`), a session, the tools the
 * user may reach (a 404 when there are none). The write limit of 60 changes
 * a minute is counted by the `PUT` route itself, per user and target, once
 * the body names a target (`enforceGoogleRateLimit`), so two quick changes of
 * different tools never share a KV key; it fails closed when KV cannot
 * count. Returns the session user id and the reachable tools; the routes
 * only ever touch that user's rows.
 */
export async function requireGoogleToolPermissionsAccess(
  event: RequestEvent,
  options: { write: boolean },
): Promise<{ userId: number, reachable: GoogleToolCatalogEntry[] }> {
  let reachable: GoogleToolCatalogEntry[] = []
  const userId = await requireGoogleAccess(event, {
    write: options.write,
    rateLimit: 'none',
    feature: false,
    authorize: async (sessionUserId) => {
      reachable = await listReachableGoogleTools(event, sessionUserId)

      if (!reachable.length) {
        throw createFeatureUnavailableError()
      }
    },
  })

  return { userId, reachable }
}
