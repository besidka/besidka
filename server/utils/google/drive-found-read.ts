import {
  GOOGLE_DRIVE_EXPORTS,
  isDriveFolder,
  isGoogleNativeMimeType,
} from '#shared/utils/google-drive'
import type {
  DriveExportChoice,
  DriveImportFailureCode,
} from '#shared/utils/google-drive'
import {
  GOOGLE_DRIVE_READ_SOURCE_MAX_BYTES,
  isGoogleDriveTextMediaType,
} from '#shared/utils/google-drive-tools'
import { GOOGLE_DOWNLOAD_TOO_LARGE_CODE } from '~~/server/utils/google/download'
import type { GoogleDownloadResult } from '~~/server/utils/google/download'
import {
  classifyDriveFailure,
  downloadDriveFile,
  exportDriveFile,
  fetchDriveFileMetadata,
  isUnsupportedExportFailure,
} from '~~/server/utils/google/drive'
import type {
  DriveFileMetadata,
  DriveRequestContext,
} from '~~/server/utils/google/drive'
import { sanitizeMailText } from '~~/server/utils/google/gmail-text'

const TEXT_DECODER = new TextDecoder()

export const FOUND_DRIVE_READ_FAILURE_TEXT: Readonly<
  Record<DriveImportFailureCode, string>
> = {
  not_found: 'Google Drive no longer returns this file. It may have been '
    + 'deleted, moved or unshared. Tell the user.',
  folder: 'This is a folder, which cannot be read.',
  unsupported_type: 'This kind of file cannot be read here.',
  not_downloadable: 'The owner of this file does not allow downloading it, '
    + 'so it cannot be read.',
  too_large: 'This file is larger than the 8 MB this tool reads. It was not '
    + 'read.',
  export_too_large: 'This file is larger than the 8 MB this tool reads. It '
    + 'was not read.',
  storage_full: 'The file could not be read from Google Drive. Try again '
    + 'later.',
  reauthorize: 'Google no longer accepts the connection to your own Google '
    + 'client. Reconnect it on the API Keys page, Google tab.',
  no_access: 'Google Drive refused access to this file. Tell the user.',
  rate_limited: 'Google Drive asked Besidka to slow down. Try again later.',
  empty: 'This file is empty.',
  failed: 'The file could not be read from Google Drive. Try again later.',
}

export interface FoundDriveFileInfo {
  name: string
  mimeType: string
  modifiedTime: Date | null
}

export type FoundDriveFileRead
  = | { status: 'ok', file: FoundDriveFileInfo, text: string, note?: string }
    | { status: 'not_text', file: FoundDriveFileInfo }
    | { status: 'failed', code: DriveImportFailureCode }

class FoundReadFailure extends Error {
  readonly code: DriveImportFailureCode

  constructor(code: DriveImportFailureCode) {
    super(code)
    this.code = code
  }
}

function infoOf(metadata: DriveFileMetadata, mimeType: string) {
  return {
    name: metadata.name,
    mimeType,
    modifiedTime: metadata.modifiedTime,
  }
}

function bytesOf(result: GoogleDownloadResult): Uint8Array {
  if (result.ok) {
    return result.bytes
  }

  throw new FoundReadFailure(classifyDriveFailure(result.status, result.reason))
}

async function exportText(
  fileId: string,
  choice: DriveExportChoice,
  context: DriveRequestContext,
): Promise<{ bytes: Uint8Array, mimeType: string }> {
  const request = { ...context, maxBytes: GOOGLE_DRIVE_READ_SOURCE_MAX_BYTES }
  const primary = await exportDriveFile(fileId, choice.mimeType, request)

  if (primary.ok) {
    return { bytes: primary.bytes, mimeType: choice.mimeType }
  }

  if (!choice.fallback || !isUnsupportedExportFailure(primary.status)) {
    throw new FoundReadFailure(
      classifyDriveFailure(primary.status, primary.reason),
    )
  }

  const fallback = await exportDriveFile(
    fileId,
    choice.fallback.mimeType,
    request,
  )

  return { bytes: bytesOf(fallback), mimeType: choice.fallback.mimeType }
}

async function readBytes(
  metadata: DriveFileMetadata,
  context: DriveRequestContext,
): Promise<FoundDriveFileRead> {
  if (isGoogleNativeMimeType(metadata.mimeType)) {
    const choice = GOOGLE_DRIVE_EXPORTS[metadata.mimeType]

    if (!choice) {
      return { status: 'not_text', file: infoOf(metadata, metadata.mimeType) }
    }

    const exported = await exportText(metadata.id, choice, context)

    return toTextResult(metadata, exported.mimeType, exported.bytes, choice)
  }

  if (!isGoogleDriveTextMediaType(metadata.mimeType)) {
    return { status: 'not_text', file: infoOf(metadata, metadata.mimeType) }
  }

  if (!metadata.canDownload) {
    throw new FoundReadFailure('not_downloadable')
  }

  const isOverLimit = metadata.size !== null
    && metadata.size > GOOGLE_DRIVE_READ_SOURCE_MAX_BYTES

  if (isOverLimit) {
    throw new FoundReadFailure('too_large')
  }

  const downloaded = await downloadDriveFile(metadata.id, {
    ...context,
    maxBytes: GOOGLE_DRIVE_READ_SOURCE_MAX_BYTES,
  })

  return toTextResult(metadata, metadata.mimeType, bytesOf(downloaded), null)
}

function toTextResult(
  metadata: DriveFileMetadata,
  mimeType: string,
  bytes: Uint8Array,
  choice: DriveExportChoice | null,
): FoundDriveFileRead {
  if (bytes.byteLength === 0) {
    throw new FoundReadFailure('empty')
  }

  return {
    status: 'ok',
    file: infoOf(metadata, mimeType),
    text: sanitizeMailText(TEXT_DECODER.decode(bytes), { keepTabs: true }),
    ...(choice?.note ? { note: choice.note } : {}),
  }
}

function classifyException(
  exception: unknown,
  metadata: DriveFileMetadata | null,
): DriveImportFailureCode | null {
  if (exception instanceof FoundReadFailure) {
    return exception.code
  }

  if (
    (exception as { code?: unknown } | null)?.code
    === GOOGLE_DOWNLOAD_TOO_LARGE_CODE
  ) {
    return metadata && isGoogleNativeMimeType(metadata.mimeType)
      ? 'export_too_large'
      : 'too_large'
  }

  return null
}

/**
 * Reads the text of one file a Drive search found, with the bring-your-own
 * `drive.readonly` token, and stores nothing: no `files` row, no R2 object,
 * no copy. The rules are the ones `importDriveFiles` uses for a picked
 * file, without the copy: `files.get` metadata on all drives first, a
 * folder or trashed file refused, a Google Doc, Sheet or Slides exported to
 * Markdown, CSV or text (Docs fall back to plain text), any other file
 * read only when its type is text, both through the exact-host Google
 * fetch with `redirect: 'manual'` and a byte cap enforced while the body
 * streams in (8 MB, the picked-read limit). The text is cleaned of control
 * and invisible characters (tabs kept). Every failure, a timeout or a
 * refused redirect included, becomes a code; Google's own message text is
 * never returned.
 */
export async function readFoundDriveFile(
  fileId: string,
  context: DriveRequestContext,
): Promise<FoundDriveFileRead> {
  let metadata: DriveFileMetadata | null = null

  try {
    const result = await fetchDriveFileMetadata(fileId, context)

    if (!result.ok) {
      return {
        status: 'failed',
        code: classifyDriveFailure(result.status, result.reason),
      }
    }

    metadata = result.metadata

    if (metadata.trashed) {
      return { status: 'failed', code: 'not_found' }
    }

    if (isDriveFolder(metadata.mimeType)) {
      return { status: 'failed', code: 'folder' }
    }

    return await readBytes(metadata, context)
  } catch (exception) {
    return {
      status: 'failed',
      code: classifyException(exception, metadata) ?? 'failed',
    }
  }
}
