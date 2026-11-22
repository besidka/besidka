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
  'https://docs.google.com/picker',
  'https://docs.google.com/picker/',
]

export function isGooglePickerPagePath(path: string): boolean {
  const pathname = path.split('?')[0] ?? ''

  return pathname.startsWith('/chats/')
}

export const GOOGLE_DRIVE_COPY_LABEL = 'Saves a copy in your Besidka files'
export const GOOGLE_DRIVE_BRAND_NAME = 'Google Drive'

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
    | 'no_access'
    | 'rate_limited'
    | 'empty'
    | 'failed'

export type DriveRequestStage = 'metadata' | 'export' | 'download'

export interface DriveGoogleDetail {
  stage: DriveRequestStage
  status: number
  reason: string | null
}

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
    google?: DriveGoogleDetail
  }

export interface DriveImportResponse {
  results: DriveImportItemResult[]
}

export const GOOGLE_DRIVE_REFRESH_MAX = GOOGLE_DRIVE_PICK_MAX

export type DriveRefreshFailureCode
  = | DriveImportFailureCode
    | 'deleted'
    | 'not_a_copy'
    | 'unknown_version'

export type DriveRefreshItemResult
  = | {
    id: string
    status: 'updated' | 'newer_copy'
    file: DriveImportedFile
    note?: string
  }
  | { id: string, status: 'up_to_date' }
  | {
    id: string
    status: 'failed'
    code: DriveRefreshFailureCode
    reason: string
  }

export interface DriveRefreshResponse {
  results: DriveRefreshItemResult[]
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

const GOOGLE_DRIVE_FALLBACK_NAME = 'Google Drive file'
const GOOGLE_DRIVE_EXTENSION_KEEP_MAX = 16

function isUnsafeNameCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  const isControl = code < 32
    || (code >= 127 && code <= 159)
    || (code >= 0x200b && code <= 0x200f)
    || (code >= 0x2028 && code <= 0x202e)
    || (code >= 0x2066 && code <= 0x2069)
    || code === 0xfeff

  return isControl || character === '/' || character === '\\'
}

/**
 * A Drive name made safe to store: control characters and path separators
 * become spaces, runs of whitespace collapse, and a name longer than
 * `GOOGLE_DRIVE_NAME_MAX` is cut in the base so a short extension survives.
 */
export function sanitizeDriveFileName(driveName: string): string {
  const cleaned = Array.from(driveName, (character) => {
    return isUnsafeNameCharacter(character) ? ' ' : character
  }).join('').replace(/\s+/g, ' ').trim()

  if (!cleaned) {
    return GOOGLE_DRIVE_FALLBACK_NAME
  }

  if (cleaned.length <= GOOGLE_DRIVE_NAME_MAX) {
    return cleaned
  }

  const dotIndex = cleaned.lastIndexOf('.')
  const extension = dotIndex > 0
    && cleaned.length - dotIndex <= GOOGLE_DRIVE_EXTENSION_KEEP_MAX
    ? cleaned.slice(dotIndex)
    : ''

  return `${cleaned.slice(0, GOOGLE_DRIVE_NAME_MAX - extension.length)}`
    + extension
}

export function buildDriveCopyName(
  driveName: string,
  choice: Pick<DriveExportChoice, 'extension' | 'nameSuffix'>,
): string {
  const suffix = `${choice.nameSuffix ?? ''}.${choice.extension}`
  const base = sanitizeDriveFileName(driveName)
    .slice(0, GOOGLE_DRIVE_NAME_MAX - suffix.length)
    .trimEnd()

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
  too_large: 'This file is too large to attach. The limit is '
    + `${GOOGLE_DRIVE_FILE_MAX_BYTES / (1024 * 1024)} MB.`,
  export_too_large: 'Google Drive cannot export this file because it is '
    + `larger than ${GOOGLE_DRIVE_EXPORT_MAX_BYTES / (1024 * 1024)} MB.`,
  no_access: 'Besidka has no access to this file. Pick it again in Google '
    + 'Drive to give access.',
  rate_limited: 'Google Drive asked Besidka to slow down. Try again in a '
    + 'moment.',
  empty: 'This file is empty.',
  storage_full: 'Your storage is full. Free space on the Storage page.',
  reauthorize: 'Google no longer accepts the connection. Reconnect Google '
    + 'Drive on the API Keys page.',
  failed: 'This file could not be copied. Try again in a moment.',
}

export const GOOGLE_DRIVE_REASON_SENTENCES: Readonly<Record<string, string>> = {
  notFound: 'Google Drive says Besidka cannot see this file. Pick it again '
    + 'to give access. If it is still missing, it was deleted or moved.',
  appNotAuthorizedToFile: 'Besidka has not been given access to this file '
    + 'yet. Pick it again in Google Drive to give access.',
  insufficientFilePermissions: 'Your Google account is not allowed to read '
    + 'this file. Ask its owner to share it with you, then pick it again.',
}

const GOOGLE_DRIVE_REASON_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

export function readDriveGoogleReason(value: unknown): string | null {
  return typeof value === 'string' && GOOGLE_DRIVE_REASON_PATTERN.test(value)
    ? value
    : null
}

/**
 * The sentence for a failed file: the generic one for its code, or a more
 * specific one when Google named a reason that tells the user what to do.
 * A file Besidka may not read for lack of access stays on the code's own
 * sentence unless the reason is one of those below.
 */
export function describeDriveFailure(
  code: DriveImportFailureCode,
  google?: Pick<DriveGoogleDetail, 'reason'>,
): string {
  const reason = google?.reason ?? null
  const isAccessCode = code === 'not_found' || code === 'no_access'

  if (isAccessCode && reason && GOOGLE_DRIVE_REASON_SENTENCES[reason]) {
    return GOOGLE_DRIVE_REASON_SENTENCES[reason]
  }

  return GOOGLE_DRIVE_FAILURE_REASONS[code]
}

export function formatDriveGoogleDetail(
  google: DriveGoogleDetail | undefined,
): string | null {
  if (!google) {
    return null
  }

  return `Google: ${google.reason ?? `HTTP ${google.status}`}, `
    + `${google.stage}`
}

export const GOOGLE_DRIVE_REFRESH_REASONS: Readonly<
  Record<'deleted' | 'not_a_copy' | 'unknown_version', string>
> = {
  deleted: 'This file is in the trash in Google Drive. Your copy is '
    + 'unchanged.',
  not_a_copy: 'This file is not a copy of a Google Drive file.',
  unknown_version: 'Google Drive did not say when this file last changed, '
    + 'so Besidka cannot tell whether your copy is current. Your copy is '
    + 'unchanged.',
}

export function getDriveRefreshFailureReason(
  code: DriveRefreshFailureCode,
): string {
  if (code === 'deleted' || code === 'not_a_copy' || code === 'unknown_version') {
    return GOOGLE_DRIVE_REFRESH_REASONS[code]
  }

  return GOOGLE_DRIVE_FAILURE_REASONS[code]
}
