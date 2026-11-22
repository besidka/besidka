import type { FileMetadata } from '#shared/types/files.d'

export const DRIVE_FILE_PART_TYPE = 'data-drive-file'

export const GOOGLE_DRIVE_PICK_MAX = 5
export const GOOGLE_DRIVE_FILE_MAX_BYTES = 20 * 1024 * 1024
export const GOOGLE_DRIVE_EXPORT_MAX_BYTES = 10 * 1024 * 1024
export const GOOGLE_DRIVE_NAME_MAX = 255
export const GOOGLE_DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/
export const GOOGLE_DRIVE_RESOURCE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export const GOOGLE_DRIVE_FOLDER_MIME_TYPE
  = 'application/vnd.google-apps.folder'
export const GOOGLE_DRIVE_NATIVE_MIME_PREFIX = 'application/vnd.google-apps.'

export const GOOGLE_PICKER_FRAME_SOURCES: readonly string[] = [
  'https://docs.google.com',
  'https://drive.google.com',
]

export function isGooglePickerPagePath(path: string): boolean {
  const pathname = path.split('?')[0] ?? ''

  return pathname.startsWith('/chats/')
}

export const GOOGLE_DRIVE_COPY_LABEL
  = 'Saves a copy in your Besidka files for 30 days'
export const GOOGLE_DRIVE_BRAND_NAME = 'Google Drive'
export const GOOGLE_DRIVE_MARK_ICON = 'simple-icons:googledrive'

export interface DriveExportChoice {
  mimeType: string
  extension: string
  nameSuffix?: string
  note?: string
  fallback?: Pick<DriveExportChoice, 'mimeType' | 'extension'>
}

export const GOOGLE_DRIVE_EXPORTS: Readonly<Record<string, DriveExportChoice>>
  = {
    'application/vnd.google-apps.document': {
      mimeType: 'text/markdown',
      extension: 'md',
      fallback: { mimeType: 'text/plain', extension: 'txt' },
    },
    'application/vnd.google-apps.spreadsheet': {
      mimeType: 'text/csv',
      extension: 'csv',
      nameSuffix: ' (first sheet)',
      note: 'Only the first sheet is included.',
    },
    'application/vnd.google-apps.presentation': {
      mimeType: 'text/plain',
      extension: 'txt',
    },
  }

export interface DriveFilePartData {
  driveFileId: string
  name: string
  mimeType: string
  link: string
}

export interface DataDriveFilePart {
  type: typeof DRIVE_FILE_PART_TYPE
  data: DriveFilePartData
}

export interface DriveImportRequestItem {
  id: string
  resourceKey?: string
}

export type DriveImportFailureCode
  = | 'not_found'
    | 'folder'
    | 'unsupported_type'
    | 'not_downloadable'
    | 'too_large'
    | 'export_too_large'
    | 'storage_full'
    | 'reauthorize'
    | 'failed'

export type DriveImportedFile = Pick<
  FileMetadata,
  'id' | 'storageKey' | 'name' | 'size' | 'type' | 'source' | 'expiresAt'
> & Partial<Pick<
  FileMetadata,
  | 'textStatus'
  | 'textBytes'
  | 'textOmittedMedia'
  | 'textOmittedCharts'
  | 'externalSource'
  | 'externalId'
  | 'externalModifiedAt'
>>

export type DriveImportItemResult
  = | {
    id: string
    status: 'imported' | 'reused'
    file: DriveImportedFile
    note?: string
  }
  | {
    id: string
    status: 'failed'
    code: DriveImportFailureCode
    reason: string
  }

export interface DriveImportResponse {
  results: DriveImportItemResult[]
}

export function isDriveFileId(value: unknown): value is string {
  return typeof value === 'string' && GOOGLE_DRIVE_FILE_ID_PATTERN.test(value)
}

export function isDriveResourceKey(value: unknown): value is string {
  return typeof value === 'string'
    && GOOGLE_DRIVE_RESOURCE_KEY_PATTERN.test(value)
}

export function buildDriveFileLink(driveFileId: string): string {
  return `https://drive.google.com/open?id=${encodeURIComponent(driveFileId)}`
}

export function isDriveFolder(mimeType: string): boolean {
  return mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE
}

export function isGoogleNativeMimeType(mimeType: string): boolean {
  return mimeType.startsWith(GOOGLE_DRIVE_NATIVE_MIME_PREFIX)
}

export function toDriveFilePart(data: {
  driveFileId: string
  name: string
  mimeType: string
}): DataDriveFilePart {
  return {
    type: DRIVE_FILE_PART_TYPE,
    data: {
      driveFileId: data.driveFileId,
      name: data.name.slice(0, GOOGLE_DRIVE_NAME_MAX),
      mimeType: data.mimeType,
      link: buildDriveFileLink(data.driveFileId),
    },
  }
}

export function isDriveFilePart(part: unknown): part is DataDriveFilePart {
  if (typeof part !== 'object' || part === null) {
    return false
  }

  const { type, data } = part as { type?: unknown, data?: unknown }

  if (type !== DRIVE_FILE_PART_TYPE || typeof data !== 'object' || !data) {
    return false
  }

  const record = data as Record<string, unknown>

  return isDriveFileId(record.driveFileId)
    && typeof record.name === 'string'
    && typeof record.mimeType === 'string'
    && typeof record.link === 'string'
}

/**
 * A reference part as stored or projected, including the name-only form a
 * public share carries (empty id, media type and link). Renderers use this;
 * only `isDriveFilePart` is strict enough to trust an id.
 */
export function isDriveFileReference(part: unknown): part is DataDriveFilePart {
  if (typeof part !== 'object' || part === null) {
    return false
  }

  const { type, data } = part as { type?: unknown, data?: unknown }

  if (type !== DRIVE_FILE_PART_TYPE || typeof data !== 'object' || !data) {
    return false
  }

  const record = data as Record<string, unknown>

  return typeof record.driveFileId === 'string'
    && typeof record.name === 'string'
    && typeof record.mimeType === 'string'
    && typeof record.link === 'string'
}

/**
 * The Drive id and name of a stored copy, read from the `files` row columns
 * the import fills. The one place a `data-drive-file` part is derived from a
 * row, so the client, the server and the share projection agree.
 */
export function driveFilePartFromFile(file: {
  name: string
  type: string
  externalSource?: string | null
  externalId?: string | null
}): DataDriveFilePart | null {
  if (file.externalSource !== 'google' || !isDriveFileId(file.externalId)) {
    return null
  }

  return toDriveFilePart({
    driveFileId: file.externalId,
    name: file.name,
    mimeType: file.type,
  })
}

/**
 * Puts the reference part of a Google Drive copy right after its file part,
 * for the message the composer sends. `files` and `fileParts` line up by
 * index. The server rebuilds these parts from the stored rows, so this only
 * lets the message show its Drive link before it is reloaded.
 */
export function withDriveFileParts<TPart>(
  files: ReadonlyArray<{
    name: string
    type: string
    externalSource?: string | null
    externalId?: string | null
  }>,
  fileParts: readonly TPart[],
): Array<TPart | DataDriveFilePart> {
  return fileParts.flatMap((part, index) => {
    const file = files[index]
    const reference = file ? driveFilePartFromFile(file) : null

    return reference ? [part, reference] : [part]
  })
}

export function buildDriveCopyName(
  driveName: string,
  choice: Pick<DriveExportChoice, 'extension' | 'nameSuffix'>,
): string {
  const suffix = `${choice.nameSuffix ?? ''}.${choice.extension}`
  const base = driveName.slice(0, GOOGLE_DRIVE_NAME_MAX - suffix.length)

  return `${base}${suffix}`
}

export const GOOGLE_DRIVE_FAILURE_REASONS: Readonly<
  Record<DriveImportFailureCode, string>
> = {
  not_found: 'Google Drive did not return this file. It may have been '
    + 'deleted or moved, or not shared with this Google account.',
  folder: 'Folders cannot be attached. Pick the files inside it.',
  unsupported_type: 'This kind of file cannot be attached.',
  not_downloadable: 'The owner of this file does not allow downloading it.',
  too_large: 'This file is too large to attach.',
  export_too_large: 'Google Drive cannot export this file because it is '
    + 'larger than 10 MB.',
  storage_full: 'Your storage is full. Free space on the Storage page.',
  reauthorize: 'Google no longer accepts the connection. Reconnect Google '
    + 'Drive on the API Keys page.',
  failed: 'This file could not be copied. Try again in a moment.',
}
