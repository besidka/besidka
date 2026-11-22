import type { KVNamespace } from '@cloudflare/workers-types'
import { and, eq, isNull } from 'drizzle-orm'
import {
  GOOGLE_DRIVE_SAVE_FAILURE_MESSAGES,
  GOOGLE_DRIVE_SAVE_CLAIM_MAX_AGE_MS,
  GOOGLE_DRIVE_SAVE_MAX_BYTES,
  GOOGLE_DRIVE_SAVE_PENDING_PREFIX,
  readSavedDriveCopyId,
} from '#shared/utils/google-drive-tools'
import type {
  DriveSaveFailureCode,
  DriveSaveResult,
  DriveSavedFile,
} from '#shared/utils/google-drive-tools'
import {
  buildDriveFileLink,
  sanitizeDriveFileName,
} from '#shared/utils/google-drive'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { classifyDriveFailure } from '~~/server/utils/google/drive'
import { createDriveFile } from '~~/server/utils/google/drive-upload'
import { getGoogleAccessToken } from '~~/server/utils/google/tokens'

type DbClient = ReturnType<typeof useDb>

export type DriveSaveTarget
  = | { fileId: string }
    | { storageKey: string }

export interface SaveFileToDriveInput {
  db: DbClient
  kv: KVNamespace
  userId: number
  target: DriveSaveTarget
  name?: string
  logger: LoggerLike
}

interface OwnedFileRow {
  id: string
  name: string
  type: string
  size: number
  storageKey: string
  externalSource: string | null
  driveCopyId: string | null
}

function failed(code: DriveSaveFailureCode): DriveSaveResult {
  return {
    status: 'failed',
    code,
    message: GOOGLE_DRIVE_SAVE_FAILURE_MESSAGES[code],
  }
}

function toSaved(
  file: Pick<OwnedFileRow, 'id' | 'name'>,
  driveFileId: string,
  isAlreadySaved: boolean,
): DriveSavedFile {
  return {
    fileId: file.id,
    driveFileId,
    name: file.name,
    link: buildDriveFileLink(driveFileId),
    isAlreadySaved,
  }
}

async function readOwnedFile(
  db: DbClient,
  userId: number,
  target: DriveSaveTarget,
): Promise<OwnedFileRow | null> {
  const [row] = await db
    .select({
      id: schema.files.id,
      name: schema.files.name,
      type: schema.files.type,
      size: schema.files.size,
      storageKey: schema.files.storageKey,
      externalSource: schema.files.externalSource,
      driveCopyId: schema.files.driveCopyId,
    })
    .from(schema.files)
    .where(and(
      'fileId' in target
        ? eq(schema.files.id, target.fileId)
        : eq(schema.files.storageKey, target.storageKey),
      eq(schema.files.userId, userId),
    ))
    .limit(1)

  return row ?? null
}

function classifyUploadFailure(
  status: number,
  reason: string | null,
): DriveSaveFailureCode {
  if (reason === 'storageQuotaExceeded') {
    return 'drive_full'
  }

  const code = classifyDriveFailure(status, reason)

  if (code === 'reauthorize') {
    return 'reauthorize'
  }

  if (code === 'rate_limited') {
    return 'rate_limited'
  }

  if (code === 'no_access' || code === 'not_found') {
    return 'no_access'
  }

  return status === 413 ? 'too_large' : 'failed'
}

async function readAccessToken(
  input: SaveFileToDriveInput,
): Promise<
  | { ok: true, accessToken: string }
  | { ok: false, code: DriveSaveFailureCode }
> {
  try {
    const token = await getGoogleAccessToken({
      userId: input.userId,
      clientMode: 'besidka',
      requiredScopes: [GOOGLE_SCOPES.driveFile],
    }, { db: input.db, kv: input.kv, logger: input.logger })

    if (token.status === 'ok') {
      return { ok: true, accessToken: token.accessToken }
    }

    return {
      ok: false,
      code: token.status === 'not_connected'
        ? 'not_connected'
        : 'reauthorize',
    }
  } catch (exception) {
    input.logger.set({
      attributes: {
        googleDriveSave: { tokenError: exceptionMessage(exception) },
      },
    })

    return { ok: false, code: 'failed' }
  }
}

async function readStoredBytes(
  storageKey: string,
): Promise<Uint8Array | null> {
  const stored = await useFileStorage().get(storageKey)

  if (!stored) {
    return null
  }

  return new Uint8Array(await stored.arrayBuffer())
}

function readPendingClaim(driveCopyId: string | null): number | null {
  if (!driveCopyId?.startsWith(GOOGLE_DRIVE_SAVE_PENDING_PREFIX)) {
    return null
  }

  const claimedAt = Number(
    driveCopyId.slice(GOOGLE_DRIVE_SAVE_PENDING_PREFIX.length),
  )

  return Number.isFinite(claimedAt) ? claimedAt : 0
}

function isLiveClaim(driveCopyId: string | null): boolean {
  const claimedAt = readPendingClaim(driveCopyId)

  return claimedAt !== null
    && Date.now() - claimedAt < GOOGLE_DRIVE_SAVE_CLAIM_MAX_AGE_MS
}

/**
 * Takes the save of one file with one atomic update of `drive_copy_id`: the
 * column goes from empty (or from an abandoned claim) to a timestamped
 * pending value, so two parallel saves cannot both reach Google. The loser
 * of the update reads the row again: a recorded copy answers
 * `already_saved`, a live claim answers `busy`.
 */
async function claimSave(
  input: SaveFileToDriveInput,
  file: OwnedFileRow,
): Promise<
  | { ok: true, claim: string }
  | { ok: false, result: DriveSaveResult }
> {
  const claim = `${GOOGLE_DRIVE_SAVE_PENDING_PREFIX}${Date.now()}`
  const isClaimable = file.driveCopyId
    ? eq(schema.files.driveCopyId, file.driveCopyId)
    : isNull(schema.files.driveCopyId)
  const claimed = await input.db
    .update(schema.files)
    .set({ driveCopyId: claim })
    .where(and(
      eq(schema.files.id, file.id),
      eq(schema.files.userId, input.userId),
      isClaimable,
    ))
    .returning({ id: schema.files.id })

  if (claimed.length > 0) {
    return { ok: true, claim }
  }

  const current = await readOwnedFile(
    input.db,
    input.userId,
    { fileId: file.id },
  )

  const concurrentCopyId = readSavedDriveCopyId(current?.driveCopyId)

  if (concurrentCopyId) {
    return {
      ok: false,
      result: {
        status: 'already_saved',
        saved: toSaved(file, concurrentCopyId, true),
      },
    }
  }

  return { ok: false, result: failed(current ? 'busy' : 'not_found') }
}

async function releaseClaim(
  input: SaveFileToDriveInput,
  file: OwnedFileRow,
  claim: string,
): Promise<void> {
  try {
    await input.db
      .update(schema.files)
      .set({ driveCopyId: null })
      .where(and(
        eq(schema.files.id, file.id),
        eq(schema.files.userId, input.userId),
        eq(schema.files.driveCopyId, claim),
      ))
  } catch (exception) {
    input.logger.set({
      attributes: {
        googleDriveSave: { releaseError: exceptionMessage(exception) },
      },
    })
  }
}

async function recordDriveCopy(
  input: SaveFileToDriveInput,
  file: OwnedFileRow,
  claim: string,
  driveFile: { id: string, name: string },
): Promise<DriveSaveResult> {
  const recorded = await input.db
    .update(schema.files)
    .set({ driveCopyId: driveFile.id })
    .where(and(
      eq(schema.files.id, file.id),
      eq(schema.files.userId, input.userId),
      eq(schema.files.driveCopyId, claim),
    ))
    .returning({ id: schema.files.id })

  if (recorded.length === 0) {
    input.logger.set({
      attributes: { googleDriveSave: { claimLost: true } },
    })

    return failed('not_recorded')
  }

  return {
    status: 'saved',
    saved: toSaved(
      { id: file.id, name: driveFile.name },
      driveFile.id,
      false,
    ),
  }
}

/**
 * Saves ONE of the user's Besidka files to their Google Drive as a new file
 * created by the app (`drive.file`), the single function behind the model
 * tool and the "Save to Google Drive" button. It never overwrites: a file
 * that already has a Drive copy (`files.drive_copy_id`) answers with that
 * copy and makes no request to Google; the Drive id is written back with a
 * compare-and-set on the empty column, so two parallel saves leave one
 * recorded copy. A copy of a Drive file (`external_source`) is refused, it
 * already lives in Drive. The checks that need no Google run before the
 * token is read. Logs ids and counts only, never a name, a token or bytes.
 */
export async function saveFileToGoogleDrive(
  input: SaveFileToDriveInput,
): Promise<DriveSaveResult> {
  const file = await readOwnedFile(input.db, input.userId, input.target)

  if (!file) {
    return failed('not_found')
  }

  if (file.externalSource) {
    return failed('drive_copy')
  }

  const savedCopyId = readSavedDriveCopyId(file.driveCopyId)

  if (savedCopyId) {
    return {
      status: 'already_saved',
      saved: toSaved(file, savedCopyId, true),
    }
  }

  if (isLiveClaim(file.driveCopyId)) {
    return failed('busy')
  }

  if (file.size <= 0) {
    return failed('empty')
  }

  if (file.size > GOOGLE_DRIVE_SAVE_MAX_BYTES) {
    return failed('too_large')
  }

  const claimed = await claimSave(input, file)

  if (!claimed.ok) {
    return claimed.result
  }

  let keepsClaim = false

  try {
    const token = await readAccessToken(input)

    if (!token.ok) {
      return failed(token.code)
    }

    const bytes = await readStoredBytes(file.storageKey)

    if (!bytes) {
      return failed('content_missing')
    }

    if (bytes.byteLength > GOOGLE_DRIVE_SAVE_MAX_BYTES) {
      return failed('too_large')
    }

    const driveName = sanitizeDriveFileName(input.name?.trim() || file.name)

    keepsClaim = true

    const created = await createDriveFile({
      accessToken: token.accessToken,
      name: driveName,
      mediaType: file.type,
      bytes,
    })

    if (!created.ok) {
      keepsClaim = false
      const code = classifyUploadFailure(created.status, created.reason)

      input.logger.set({
        attributes: {
          googleDriveSave: { failure: code, status: created.status },
        },
      })

      return failed(code)
    }

    const result = await recordDriveCopy(input, file, claimed.claim, {
      id: created.driveFileId,
      name: driveName,
    })

    input.logger.set({
      attributes: {
        googleDriveSave: { outcome: result.status, bytes: bytes.byteLength },
      },
    })

    return result
  } catch (exception) {
    input.logger.set({
      attributes: {
        googleDriveSave: {
          error: exceptionMessage(exception),
          afterUploadStarted: keepsClaim,
        },
      },
    })

    return failed(keepsClaim ? 'unconfirmed' : 'failed')
  } finally {
    if (!keepsClaim) {
      await releaseClaim(input, file, claimed.claim)
    }
  }
}
