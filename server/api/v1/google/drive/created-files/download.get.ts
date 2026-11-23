import { defineEventHandler, getQuery } from 'nuxt/server'
import { createError } from 'evlog'
import { z } from 'zod'
import { GOOGLE_DRIVE_FILE_ID_PATTERN } from '#shared/utils/google-drive'
import {
  GOOGLE_FILE_DOWNLOAD_FORMATS,
  buildGoogleFileDisposition,
  findGoogleFileDownloadOption,
} from '#shared/utils/google-file-download'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import { exceptionSummary } from '~~/server/utils/evlog-attributes'
import { requireGoogleByoAccess } from '~~/server/utils/google/byo-access'
import {
  downloadCreatedGoogleFile,
  findCreatedGoogleFile,
} from '~~/server/utils/google/created-file-download'
import { requireGoogleAccessToken } from '~~/server/utils/google/tokens'
import { requireLegalConsent } from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const querySchema = z.object({
  chatSlug: z.ulid(),
  fileId: z.string().regex(GOOGLE_DRIVE_FILE_ID_PATTERN),
  format: z.enum(GOOGLE_FILE_DOWNLOAD_FORMATS),
}).strict()

/**
 * Downloads a file that `google__drive_create_file` created in one of the
 * user's own chats as a real file: DOCX or text for a Google Doc, XLSX or
 * the first sheet as CSV for a Google Sheet, the raw text for a text file.
 * The file id counts only when that chat's stored tool parts say the tool
 * created it (the kind and the name come from the stored part, never from the
 * query), the chat is the signed-in user's, and the user holds an active own
 * Google client connection behind the admin and `google.byo` gate. Drive's
 * answer goes to the browser through the Worker and is stored nowhere: no R2,
 * D1 or KV copy, no model. At most 30 downloads an hour a user.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireGoogleByoAccess(event, {
    write: false,
    rateLimit: 'download',
  })
  const logger = useRequestLogger(event)
  const query = querySchema.safeParse(getQuery(event))

  if (!query.success) {
    throw createError({
      message: 'Invalid download request',
      status: 400,
      why: 'The request does not name a valid chat, file and format',
      fix: 'Use the Download menu of the file preview',
    })
  }

  await requireLegalConsent(userId)

  const { chatSlug, fileId, format } = query.data
  const db = useDb()
  const file = await findCreatedGoogleFile(db, userId, chatSlug, fileId)

  if (!file) {
    throw createError({
      message: 'File not found',
      status: 404,
      why: 'No file was created with that id in this chat',
      fix: 'Open the file from the chat that created it',
    })
  }

  if (!findGoogleFileDownloadOption(file.kind, format)) {
    throw createError({
      message: 'That format is not available for this file',
      status: 400,
      why: 'The format is not allowed for this kind of file',
      fix: 'Choose one of the formats the menu offers',
    })
  }

  try {
    const { accessToken } = await requireGoogleAccessToken(
      {
        userId,
        clientMode: 'byo',
        requiredScopes: [GOOGLE_SCOPES.driveReadonly],
      },
      { db, kv: useKV(), logger },
    )
    const download = await downloadCreatedGoogleFile({
      file,
      format,
      accessToken,
    })

    logger.set({
      attributes: {
        googleCreatedFileDownload: {
          kind: file.kind,
          format,
          bytes: download.bytes.byteLength,
          outcome: 'ok',
        },
      },
    })

    return new Response(download.bytes as BodyInit, {
      headers: {
        'Content-Type': download.contentType,
        'Content-Disposition': buildGoogleFileDisposition(download.fileName),
        'Content-Length': String(download.bytes.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (exception) {
    const status = (exception as { status?: unknown }).status

    logger.set({
      attributes: {
        googleCreatedFileDownload: {
          kind: file.kind,
          format,
          outcome: 'refused',
          ...(typeof status === 'number'
            ? { status }
            : exceptionSummary(exception)),
        },
      },
    })

    throw exception
  }
})
