import type { KVNamespace } from '@cloudflare/workers-types'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import type { RequestEvent } from 'nuxt/server'
import { normalizeMediaType } from '#shared/utils/files'
import { isDriveFileId } from '#shared/utils/google-drive'
import type { DriveImportFailureCode } from '#shared/utils/google-drive'
import {
  GOOGLE_DRIVE_LIST_MAX,
  GOOGLE_DRIVE_READ_SOURCE_MAX_BYTES,
} from '#shared/utils/google-drive-tools'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { importDriveFiles } from '~~/server/utils/google/drive-import'

type DbClient = ReturnType<typeof useDb>

const LIST_CANDIDATE_LIMIT = 200

const STALE_COPY_FALLBACK_CODES: ReadonlySet<DriveImportFailureCode>
  = new Set(['rate_limited', 'failed', 'storage_full'])

export const GOOGLE_DRIVE_READ_FAILURE_TEXT: Readonly<
  Record<DriveImportFailureCode, string>
> = {
  not_found: 'Google Drive no longer returns this file. It may have been '
    + 'deleted, moved or unshared. Tell the user.',
  folder: 'This is a folder, which cannot be read.',
  unsupported_type: 'This kind of file cannot be read here.',
  not_downloadable: 'The owner of this file does not allow downloading it, '
    + 'so it cannot be read.',
  too_large: 'This file is larger than 20 MB and cannot be read here.',
  export_too_large: 'Google Drive cannot export this file because it is '
    + 'larger than 10 MB.',
  storage_full: 'The user\'s Besidka storage is full, so a fresh copy of '
    + 'this file could not be made. Tell the user to free space.',
  reauthorize: 'Google no longer accepts the connection. Tell the user to '
    + 'reconnect Google Drive on the API Keys page.',
  no_access: 'Besidka has no access to this file any more. Tell the user to '
    + 'pick it again in Google Drive.',
  rate_limited: 'Google Drive asked Besidka to slow down. Try again later.',
  empty: 'This file is empty.',
  failed: 'The file could not be read from Google Drive. Try again later.',
}

export interface PickedDriveFile {
  id: string
  driveFileId: string
  name: string
  type: string
  size: number
  copiedAt: Date
  modifiedAt: Date | null
}

export type PickedDriveRead
  = | {
    status: 'ok'
    file: PickedDriveFile
    text: string
    isStale: boolean
  }
  | { status: 'not_text', file: PickedDriveFile }
  | { status: 'not_picked' }
  | { status: 'failed', code: DriveImportFailureCode, message: string }

const pickedFileColumns = {
  id: schema.files.id,
  name: schema.files.name,
  type: schema.files.type,
  size: schema.files.size,
  storageKey: schema.files.storageKey,
  externalId: schema.files.externalId,
  externalModifiedAt: schema.files.externalModifiedAt,
  createdAt: schema.files.createdAt,
}

type PickedRow = {
  id: string
  name: string
  type: string
  size: number
  storageKey: string
  externalId: string | null
  externalModifiedAt: Date | null
  createdAt: Date
}

function toPickedFile(row: PickedRow): PickedDriveFile | null {
  if (!isDriveFileId(row.externalId)) {
    return null
  }

  return {
    id: row.id,
    driveFileId: row.externalId,
    name: row.name,
    type: row.type,
    size: row.size,
    copiedAt: row.createdAt,
    modifiedAt: row.externalModifiedAt,
  }
}

/**
 * The Drive files the user picked, newest copy first and one entry per Drive
 * file (a refreshed file leaves older copies behind until they expire). One
 * D1 query, no call to Google, and nothing but references: ids, names, types
 * and dates.
 */
export async function listPickedDriveFiles(
  db: DbClient,
  userId: number,
): Promise<PickedDriveFile[]> {
  const rows = await db
    .select(pickedFileColumns)
    .from(schema.files)
    .where(and(
      eq(schema.files.userId, userId),
      eq(schema.files.externalSource, 'google'),
      isNotNull(schema.files.externalId),
    ))
    .orderBy(desc(schema.files.createdAt))
    .limit(LIST_CANDIDATE_LIMIT)
  const seen = new Set<string>()
  const files: PickedDriveFile[] = []

  for (const row of rows) {
    const file = toPickedFile(row)

    if (!file || seen.has(file.driveFileId)) {
      continue
    }

    seen.add(file.driveFileId)
    files.push(file)

    if (files.length >= GOOGLE_DRIVE_LIST_MAX) {
      break
    }
  }

  return files
}

async function readOwnedPickedRow(
  db: DbClient,
  userId: number,
  fileId: string,
): Promise<PickedRow | null> {
  const [row] = await db
    .select(pickedFileColumns)
    .from(schema.files)
    .where(and(
      eq(schema.files.id, fileId),
      eq(schema.files.userId, userId),
      eq(schema.files.externalSource, 'google'),
    ))
    .limit(1)

  return row ?? null
}

async function readStoredText(
  storageKey: string,
  size: number,
): Promise<string | null> {
  if (size > GOOGLE_DRIVE_READ_SOURCE_MAX_BYTES) {
    return null
  }

  const stored = await useFileStorage().get(storageKey)

  return stored ? await stored.text() : null
}

function isReadableAsText(mediaType: string): boolean {
  return normalizeMediaType(mediaType).startsWith('text/')
}

/**
 * Reads one file the user picked, by the id of one of their own copies (the
 * id the list returned). An id that is not one of the user's Google copies
 * is refused before any call to Google. A binary file answers `not_text`
 * without a call. For text, the copy is made current first through the same
 * import the Picker uses: it reuses an unchanged copy (one metadata call)
 * and downloads again only when the Drive original changed. When Google is
 * busy or unreachable the stored copy is read and marked `isStale`; any
 * other failure is a model-readable `failed` answer.
 */
export async function readPickedDriveFile(input: {
  event: Pick<RequestEvent, 'context'>
  db: DbClient
  kv: KVNamespace
  userId: number
  fileId: string
  logger: LoggerLike
}): Promise<PickedDriveRead> {
  const row = await readOwnedPickedRow(input.db, input.userId, input.fileId)
  const picked = row ? toPickedFile(row) : null

  if (!row || !picked) {
    return { status: 'not_picked' }
  }

  if (!isReadableAsText(row.type)) {
    return { status: 'not_text', file: picked }
  }

  const [result] = await importDriveFiles({
    event: input.event,
    db: input.db,
    kv: input.kv,
    userId: input.userId,
    items: [{ id: picked.driveFileId }],
    logger: input.logger,
  })
  let current: PickedRow = row
  let isStale = false

  if (result?.status === 'failed') {
    if (!STALE_COPY_FALLBACK_CODES.has(result.code)) {
      return {
        status: 'failed',
        code: result.code,
        message: GOOGLE_DRIVE_READ_FAILURE_TEXT[result.code],
      }
    }

    isStale = true
  } else if (result?.file.id && result.file.id !== row.id) {
    current = await readOwnedPickedRow(input.db, input.userId, result.file.id)
      ?? row
  }

  const text = await readStoredText(current.storageKey, current.size)

  if (text === null) {
    return {
      status: 'failed',
      code: 'failed',
      message: current.size > GOOGLE_DRIVE_READ_SOURCE_MAX_BYTES
        ? 'This file is larger than 8 MB and cannot be read here.'
        : GOOGLE_DRIVE_READ_FAILURE_TEXT.failed,
    }
  }

  return {
    status: 'ok',
    file: toPickedFile(current) ?? picked,
    text,
    isStale,
  }
}
