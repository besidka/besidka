import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { GOOGLE_DRIVE_REFRESH_MAX } from '#shared/utils/google-drive'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { refreshDriveCopies } from '~~/server/utils/google/drive-import'
import { requireGoogleAccess } from '~~/server/utils/google/route'
import { requireGoogleAccessToken } from '~~/server/utils/google/tokens'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { requireLegalConsent } from '~~/server/utils/legal/consent'

const bodySchema = z.object({
  ids: z.array(z.string().min(1).max(64))
    .min(1)
    .max(GOOGLE_DRIVE_REFRESH_MAX)
    .refine((ids) => {
      return new Set(ids).size === ids.length
    }, { message: 'Each copy can be refreshed once per request.' }),
}).strict()

/**
 * Checks the Google Drive original of the user's own copies and copies it
 * again when it changed. One result per copy: updated (a new copy; the
 * selected one is left for the messages that used it), up to date, a newer
 * copy that already exists, or a plain failure. A file that is not the
 * user's own Google copy fails without any Google call. Besidka's own
 * Google client only; a missing or ended connection answers 404 or 409
 * before anything is read.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleAccess(event, {
    write: true,
    rateLimit: 'import',
  })
  const logger = useRequestLogger(event)
  const body = await readConnectorBody(event, bodySchema)

  await requireLegalConsent(userId)

  const db = useDb()
  const kv = useKV()

  await requireGoogleAccessToken({
    userId,
    clientMode: 'besidka',
    requiredScopes: [GOOGLE_SCOPES.driveFile],
  }, { db, kv, logger })

  event.res.headers.set('cache-control', 'no-store')

  const results = await refreshDriveCopies({
    event,
    db,
    kv,
    userId,
    fileIds: body.ids,
    logger,
  })

  return { results }
})
