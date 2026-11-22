import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import {
  GOOGLE_DRIVE_FILE_ID_PATTERN,
  GOOGLE_DRIVE_PICK_MAX,
  GOOGLE_DRIVE_RESOURCE_KEY_PATTERN,
} from '#shared/utils/google-drive'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { importDriveFiles } from '~~/server/utils/google/drive-import'
import { requireGoogleAccess } from '~~/server/utils/google/route'
import { requireGoogleAccessToken } from '~~/server/utils/google/tokens'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { requireLegalConsent } from '~~/server/utils/legal/consent'

const bodySchema = z.object({
  items: z.array(z.object({
    id: z.string().regex(GOOGLE_DRIVE_FILE_ID_PATTERN),
    resourceKey: z.string().regex(GOOGLE_DRIVE_RESOURCE_KEY_PATTERN).optional(),
  }).strict())
    .min(1)
    .max(GOOGLE_DRIVE_PICK_MAX)
    .refine((items) => {
      return new Set(items.map(item => item.id)).size === items.length
    }, { message: 'Each file can be picked once.' }),
}).strict()

/**
 * Copies the Google Drive files the user picked into Besidka's storage as
 * snapshots, through the same persistence path as an upload. One result per
 * file: a file can fail (a folder, a type that cannot be attached, too
 * large, storage full, not downloadable) while the others succeed. Besidka's
 * own Google client only; a missing or ended connection answers 404 or 409
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

  const results = await importDriveFiles({
    event,
    db,
    kv,
    userId,
    items: body.items,
    logger,
  })

  return { results }
})
