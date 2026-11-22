import { defineEventHandler } from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'
import type {
  GoogleByoConnectionStatus,
  GoogleConnectionStatusResponse,
} from '#shared/utils/google-connections'
import { isGoogleByoAllowed } from '~~/server/utils/google/byo-access'
import { readGoogleByoClientSummary } from '~~/server/utils/google/byo-client'
import {
  buildGoogleRedirectUri,
  isDedicatedGoogleClientConfigured,
} from '~~/server/utils/google/client'
import {
  isGoogleFeatureActive,
  requireGoogleAccess,
} from '~~/server/utils/google/route'
import {
  readGoogleConnection,
  toGoogleConnectionSummary,
} from '~~/server/utils/google/store'
import type { GoogleConnectionRecord } from '~~/server/utils/google/store'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { resolveRequestPublicOrigin } from '~~/server/utils/request-public-origin'

type DbClient = ReturnType<typeof useDb>

function toVisibleSummary(record: GoogleConnectionRecord | null) {
  return record && record.status !== 'revoked'
    ? toGoogleConnectionSummary(record)
    : null
}

async function canManageByo(
  event: RequestEvent,
  db: DbClient,
  userId: number,
): Promise<boolean> {
  try {
    return await isGoogleByoAllowed({
      db,
      userId,
      logger: useRequestLogger(event),
    })
  } catch {
    return false
  }
}

/**
 * The bring-your-own part of the status: `null` unless the user passes the
 * admin and `google.byo` gate or still has a bring-your-own connection.
 * Only a user who passes the gate gets the redirect URI to register and
 * the stored client's hint (the last four characters of its client id,
 * never the secret); a connected user who no longer passes it still sees
 * the connection, so it can always be ended.
 */
async function readByoStatus(
  event: RequestEvent,
  db: DbClient,
  userId: number,
): Promise<GoogleByoConnectionStatus | null> {
  const canManage = await canManageByo(event, db, userId)
  const connection = toVisibleSummary(
    await readGoogleConnection(db, userId, 'byo'),
  )

  if (!canManage) {
    return connection
      ? { canManage: false, redirectUri: null, client: null, connection }
      : null
  }

  return {
    canManage: true,
    redirectUri: buildGoogleRedirectUri(
      resolveRequestPublicOrigin(event),
      'byo',
    ),
    client: await readGoogleByoClientSummary(db, userId),
    connection,
  }
}

/**
 * The Google connections as the API Keys page shows them. Besidka's mode:
 * status, the Google account's email, the granted capabilities and when it
 * was connected; `canConnect` says whether `google.drive` is active for
 * the user, and `dedicatedClient` whether Drive runs on its own OAuth
 * client (no ids). `byo` adds the owner's own client (`readByoStatus`).
 * Needs only a session, so a connected user always sees a connection. A
 * `revoked` row (a disconnect whose cleanup is still running) reads as not
 * connected. Never returns a token or a client secret.
 */
export default defineEventHandler(async (
  event,
): Promise<GoogleConnectionStatusResponse> => {
  const userId = await requireGoogleAccess(event, {
    write: false,
    rateLimit: 'read',
    feature: false,
  })
  const db = useDb()
  const record = await readGoogleConnection(db, userId, 'besidka')
  const canConnect = await isGoogleFeatureActive(event)
  const byo = await readByoStatus(event, db, userId)

  event.res.headers.set('cache-control', 'private, no-store')

  return {
    connection: toVisibleSummary(record),
    canConnect,
    dedicatedClient: isDedicatedGoogleClientConfigured(),
    byo,
  }
})
