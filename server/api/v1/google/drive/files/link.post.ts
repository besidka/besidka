import { defineEventHandler } from 'nuxt/server'
import { createError } from 'evlog'
import { z } from 'zod'
import {
  GOOGLE_DRIVE_LINK_MAX_LENGTH,
  parseGoogleDriveLink,
} from '#shared/utils/google-drive-links'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { importDriveFiles } from '~~/server/utils/google/drive-import'
import { requireGoogleAccess } from '~~/server/utils/google/route'
import { requireGoogleAccessToken } from '~~/server/utils/google/tokens'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { requireLegalConsent } from '~~/server/utils/legal/consent'

const bodySchema = z.object({
  link: z.string().min(1).max(GOOGLE_DRIVE_LINK_MAX_LENGTH),
}).strict()

/**
 * Copies the Google file a pasted link names, when Besidka already has
 * access to it (the user picked it before). The link is parsed again here
 * with the same strict parser the composer uses, so only the file id and an
 * optional resource key ever reach Google; nothing else of the link does.
 * Without access the answer is a failed result (not found or no access) and
 * nothing is stored: the composer then offers the Picker for that one file.
 * One file per request, no retry (a file that was not just picked has no
 * grant that could still be on its way), and Besidka's own Google client
 * only, like the other Drive routes.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleAccess(event, {
    write: true,
    rateLimit: 'import',
  })
  const logger = useRequestLogger(event)
  const body = await readConnectorBody(event, bodySchema)
  const link = parseGoogleDriveLink(body.link)

  if (!link) {
    throw createError({
      message: 'That is not a link to a Google file',
      status: 400,
      why: 'Only Google Docs, Sheets, Slides and Drive file links are read',
      fix: 'Paste a link to a file, not to a folder',
    })
  }

  await requireLegalConsent(userId)

  const db = useDb()
  const kv = useKV()

  await requireGoogleAccessToken({
    userId,
    clientMode: 'besidka',
    requiredScopes: [GOOGLE_SCOPES.driveFile],
  }, { db, kv, logger })

  event.res.headers.set('cache-control', 'no-store')

  const item = link.resourceKey
    ? { id: link.id, resourceKey: link.resourceKey }
    : { id: link.id }
  const results = await importDriveFiles({
    event,
    db,
    kv,
    userId,
    items: [item],
    logger,
  })

  logger.set({ attributes: { googleDrive: { fromLink: true } } })

  return { item, kind: link.kind, results }
})
