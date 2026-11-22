import { defineEventHandler } from 'nuxt/server'
import { createError } from 'evlog'
import { z } from 'zod'
import { isSafeFileStorageKey } from '#shared/utils/files'
import { GOOGLE_DRIVE_SAVE_FAILURE_STATUS } from '#shared/utils/google-drive-tools'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { saveFileToGoogleDrive } from '~~/server/utils/google/drive-save'
import { requireGoogleAccess } from '~~/server/utils/google/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { requireLegalConsent } from '~~/server/utils/legal/consent'

const bodySchema = z.object({
  storageKey: z.string().refine(isSafeFileStorageKey),
}).strict()

/**
 * "Save to Google Drive" as a user action: one file of the signed-in user,
 * chosen by the click, saved as a new Drive file through the same function
 * the model tool uses, with no model and no approval card (the click is the
 * consent, and Google's Drive API terms bar automatic or bulk saving, so
 * there is no body that names more than one file). Besidka's own client
 * only; a missing or ended connection answers 404 or 409, a file that is
 * not the user's answers 404, and a file that was saved before answers with
 * its existing Drive link and creates nothing.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleAccess(event, {
    write: true,
    rateLimit: 'save',
  })
  const logger = useRequestLogger(event)
  const body = await readConnectorBody(event, bodySchema)

  await requireLegalConsent(userId)

  event.res.headers.set('cache-control', 'no-store')

  const result = await saveFileToGoogleDrive({
    db: useDb(),
    kv: useKV(),
    userId,
    target: { storageKey: body.storageKey },
    logger,
  })

  if (result.status === 'failed') {
    throw createError({
      message: result.message,
      status: GOOGLE_DRIVE_SAVE_FAILURE_STATUS[result.code],
      why: `The save was refused: ${result.code}`,
      fix: 'Follow the message above',
    })
  }

  return {
    status: result.status,
    fileId: result.saved.fileId,
    driveFileId: result.saved.driveFileId,
    name: result.saved.name,
    link: result.saved.link,
  }
})
