import { createError } from 'evlog'
import { and, eq } from 'drizzle-orm'
import { readGoogleCreatedFile } from '#shared/utils/google-created-file'
import type { GoogleCreatedFile } from '#shared/utils/google-created-file'
import { GOOGLE_DRIVE_EXPORT_MAX_BYTES } from '#shared/utils/google-drive'
import { GOOGLE_DRIVE_FILE_KIND_SPECS } from '#shared/utils/google-drive-write'
import {
  GOOGLE_FILE_DOWNLOAD_TYPES,
  buildGoogleFileDownloadName,
  findGoogleFileDownloadOption,
} from '#shared/utils/google-file-download'
import type { GoogleFileDownloadFormat } from '#shared/utils/google-file-download'
import * as schema from '~~/server/db/schema'
import { loadChatContextRows } from '~~/server/utils/chats/context/load-chat-context'
import {
  classifyDriveFailure,
  downloadDriveFile,
  exportDriveFile,
} from '~~/server/utils/google/drive'
import type { GoogleDownloadResult } from '~~/server/utils/google/download'
import { readDriveItemMeta } from '~~/server/utils/google/drive-write-api'
import type { GoogleFetchImplementation } from '~~/server/utils/google/http'

type DbClient = ReturnType<typeof useDb>

const TOO_LARGE_STATUS = 413

type DownloadFailureCode
  = | 'reauthorize'
    | 'not_found'
    | 'export_too_large'
    | 'not_downloadable'
    | 'rate_limited'
    | 'no_access'
    | 'failed'
    | 'trashed'
    | 'shared_drive'
    | 'changed'

interface DownloadFailure {
  status: number
  message: string
  why: string
  fix: string
}

export const GOOGLE_FILE_DOWNLOAD_FAILURES: Readonly<
  Record<DownloadFailureCode, DownloadFailure>
> = {
  reauthorize: {
    status: 409,
    message: 'Reconnect Google',
    why: 'Google no longer accepts the connection to your own Google client',
    fix: 'Reconnect Google in your Besidka settings',
  },
  not_found: {
    status: 404,
    message: 'The file is not in Google Drive any more',
    why: 'Google Drive could not find it, or you have no access to it',
    fix: 'Open Google Drive to look for it',
  },
  export_too_large: {
    status: TOO_LARGE_STATUS,
    message: 'The file is too large to download here',
    why: 'Google Drive exports are limited to 10 MB',
    fix: 'Open the file in Google and download it from there',
  },
  not_downloadable: {
    status: 403,
    message: 'Google Drive does not allow downloading this file',
    why: 'The file has a download restriction',
    fix: 'Open the file in Google',
  },
  rate_limited: {
    status: 429,
    message: 'Google Drive asked Besidka to slow down',
    why: 'Google Drive rate limit reached',
    fix: 'Try again in a moment',
  },
  no_access: {
    status: 403,
    message: 'Google Drive did not allow the download',
    why: 'Your own Google client has no access to this file',
    fix: 'Open the file in Google',
  },
  failed: {
    status: 502,
    message: 'Google Drive could not be reached',
    why: 'Google Drive answered with an error or did not answer',
    fix: 'Try again in a moment',
  },
  trashed: {
    status: 404,
    message: 'The file is in the Google Drive trash',
    why: 'A file in the trash is not downloaded',
    fix: 'Restore it in Google Drive first',
  },
  shared_drive: {
    status: 409,
    message: 'The file is now in a shared drive',
    why: 'Only files in My Drive are downloaded here',
    fix: 'Open the file in Google Drive',
  },
  changed: {
    status: 409,
    message: 'The file is no longer the file Besidka created',
    why: 'Its type in Google Drive changed',
    fix: 'Open the file in Google Drive',
  },
}

function refusal(code: DownloadFailureCode) {
  const { status, message, why, fix } = GOOGLE_FILE_DOWNLOAD_FAILURES[code]

  return createError({ message, status, why, fix })
}

function driveFailure(status: number, reason: string | null) {
  const code: string = classifyDriveFailure(status, reason)

  return refusal(code in GOOGLE_FILE_DOWNLOAD_FAILURES
    ? code as DownloadFailureCode
    : 'failed')
}

/**
 * The file that `google__drive_create_file` created in this chat, read from
 * the chat's stored tool parts and only when the chat belongs to the user.
 * Only assistant messages count, so a part forged into a user message never
 * names a file. Kind and name come from the stored part. A file in a message
 * older than the newest `CHAT_CONTEXT_MAX_MESSAGES` is not found.
 */
export async function findCreatedGoogleFile(
  db: DbClient,
  userId: number,
  chatSlug: string,
  driveFileId: string,
): Promise<GoogleCreatedFile | null> {
  const chat = await db.select({ id: schema.chats.id })
    .from(schema.chats)
    .where(and(
      eq(schema.chats.slug, chatSlug),
      eq(schema.chats.userId, userId),
    ))
    .get()

  if (!chat) {
    return null
  }

  const { rows } = await loadChatContextRows(db, chat.id, {
    includeUsage: false,
  })

  for (const row of rows) {
    if (row.role !== 'assistant' || !Array.isArray(row.parts)) {
      continue
    }

    for (const part of row.parts) {
      const file = readGoogleCreatedFile(part)

      if (file && file.id === driveFileId) {
        return file
      }
    }
  }

  return null
}

export interface CreatedFileDownload {
  bytes: Uint8Array
  contentType: string
  fileName: string
}

export interface CreatedFileDownloadInput {
  file: GoogleCreatedFile
  format: GoogleFileDownloadFormat
  accessToken: string
  fetchImpl?: GoogleFetchImplementation
}

async function requestBytes(
  input: CreatedFileDownloadInput,
  exportMimeType: string | null,
): Promise<GoogleDownloadResult> {
  const context = {
    accessToken: input.accessToken,
    maxBytes: GOOGLE_DRIVE_EXPORT_MAX_BYTES,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  }

  try {
    return exportMimeType
      ? await exportDriveFile(input.file.id, exportMimeType, context)
      : await downloadDriveFile(input.file.id, context)
  } catch (exception) {
    const status = (exception as { status?: unknown }).status

    if (status === TOO_LARGE_STATUS) {
      throw refusal('export_too_large')
    }

    throw exception
  }
}

/**
 * Reads the live metadata of a created file and refuses a file in the trash,
 * in a shared drive or of another type than the one created, then exports it
 * (a document or a spreadsheet) or reads it raw (a text file). Drive's answer
 * is buffered up to 10 MB so every refusal is a proper status before the
 * first byte goes out. The redirect rule and the byte cap are those of
 * `googleFetchBytes`.
 */
export async function downloadCreatedGoogleFile(
  input: CreatedFileDownloadInput,
): Promise<CreatedFileDownload> {
  const option = findGoogleFileDownloadOption(input.file.kind, input.format)

  if (!option) {
    throw createError({
      message: 'That format is not available for this file',
      status: 400,
      why: 'The format is not allowed for this kind of file',
      fix: 'Choose one of the formats the menu offers',
    })
  }

  const meta = await readDriveItemMeta(input.file.id, {
    accessToken: input.accessToken,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  })

  if (!meta.ok) {
    throw driveFailure(meta.status ?? 0, meta.reason ?? null)
  }

  if (meta.value.trashed === true) {
    throw refusal('trashed')
  }

  if (meta.value.driveId !== null) {
    throw refusal('shared_drive')
  }

  const expectedMimeType
    = GOOGLE_DRIVE_FILE_KIND_SPECS[input.file.kind].targetMimeType

  if (meta.value.mimeType !== expectedMimeType) {
    throw refusal('changed')
  }

  const result = await requestBytes(input, option.exportMimeType)

  if (!result.ok) {
    throw driveFailure(result.status, result.reason)
  }

  return {
    bytes: result.bytes,
    contentType: GOOGLE_FILE_DOWNLOAD_TYPES[input.format].contentType,
    fileName: buildGoogleFileDownloadName(
      input.file.title,
      input.file.kind,
      input.format,
    ),
  }
}
