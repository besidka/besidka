import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import type { KVNamespace } from '@cloudflare/workers-types'
import type { RequestEvent } from 'nuxt/server'
import {
  GOOGLE_DRIVE_EXPORTS,
  GOOGLE_DRIVE_EXPORT_MAX_BYTES,
  GOOGLE_DRIVE_FAILURE_REASONS,
  GOOGLE_DRIVE_FILE_MAX_BYTES,
  buildDriveCopyName,
  getDriveRefreshFailureReason,
  isDriveFileId,
  isDriveFolder,
  isGoogleNativeMimeType,
  sanitizeDriveFileName,
} from '#shared/utils/google-drive'
import type {
  DriveExportChoice,
  DriveImportFailureCode,
  DriveImportItemResult,
  DriveImportRequestItem,
  DriveImportedFile,
  DriveRefreshFailureCode,
  DriveRefreshItemResult,
} from '#shared/utils/google-drive'
import { GOOGLE_EXTERNAL_SOURCES } from '#shared/utils/google-data-policy'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import type { OfficeFormat } from '#shared/utils/office-files'
import * as schema from '~~/server/db/schema'
import { decodePublicId } from '~~/server/utils/custom-db-types'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  getEffectiveUserFilePolicy,
  getUserStorageUsageBytes,
} from '~~/server/utils/files/file-governance'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { assertOfficeUploadBytes } from '~~/server/utils/files/office-upload-check'
import { persistFile } from '~~/server/utils/files/persist-file'
import { resolveUploadFileType } from '~~/server/utils/files/upload-file-type'
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
import { GOOGLE_DOWNLOAD_TOO_LARGE_CODE } from '~~/server/utils/google/download'
import type { GoogleDownloadResult } from '~~/server/utils/google/download'
import { getGoogleAccessToken } from '~~/server/utils/google/tokens'
import { isStorageFullError } from '~~/server/utils/storage/errors'

type DbClient = ReturnType<typeof useDb>

const REUSE_CANDIDATE_LIMIT = 3
const REUSE_MIN_REMAINING_MS = 60 * 60 * 1000

export interface DriveImportInput {
  event: Pick<RequestEvent, 'context'>
  db: DbClient
  kv: KVNamespace
  userId: number
  items: readonly DriveImportRequestItem[]
  logger: LoggerLike
  maxBytes?: number
}

interface ItemContext {
  input: DriveImportInput
  item: DriveImportRequestItem
  request: DriveRequestContext
}

class DriveItemFailure extends Error {
  readonly code: DriveImportFailureCode

  constructor(code: DriveImportFailureCode) {
    super(code)
    this.code = code
  }
}

interface CopyPlan {
  mediaType: string
  fileName: string
  note?: string
  officeFormat: OfficeFormat | null
  exportChoice: DriveExportChoice | null
}

function failed(
  id: string,
  code: DriveImportFailureCode,
): DriveImportItemResult {
  return {
    id,
    status: 'failed',
    code,
    reason: GOOGLE_DRIVE_FAILURE_REASONS[code],
  }
}

async function planCopy(
  context: ItemContext,
  metadata: DriveFileMetadata,
): Promise<CopyPlan> {
  if (isDriveFolder(metadata.mimeType)) {
    throw new DriveItemFailure('folder')
  }

  if (isGoogleNativeMimeType(metadata.mimeType)) {
    const exportChoice = GOOGLE_DRIVE_EXPORTS[metadata.mimeType]

    if (!exportChoice) {
      throw new DriveItemFailure('unsupported_type')
    }

    return {
      mediaType: exportChoice.mimeType,
      fileName: buildDriveCopyName(metadata.name, exportChoice),
      note: exportChoice.note,
      officeFormat: null,
      exportChoice,
    }
  }

  if (!metadata.canDownload) {
    throw new DriveItemFailure('not_downloadable')
  }

  try {
    const resolved = await resolveUploadFileType({
      event: context.input.event,
      fileName: metadata.name,
      declaredType: metadata.mimeType,
      logger: context.input.logger,
    })

    return {
      mediaType: resolved.mediaType,
      fileName: sanitizeDriveFileName(metadata.name),
      officeFormat: resolved.officeFormat,
      exportChoice: null,
    }
  } catch {
    throw new DriveItemFailure('unsupported_type')
  }
}

function isCopyNewerThanEdit(createdAt: Date, modifiedTime: Date): boolean {
  const editSecond = Math.floor(modifiedTime.getTime() / 1000)

  return createdAt.getTime() >= (editSecond + 1) * 1000
}

/**
 * The newest copy of the same Drive file at the same `modifiedTime` that
 * has more than an hour left and whose R2 object still exists.
 * `files.external_modified_at`
 * keeps whole seconds, so a copy made in the same second as the edit it
 * carries is never reused: a second edit in that second could not be told
 * apart from it.
 */
async function findReusableCopy(
  context: ItemContext,
  metadata: DriveFileMetadata,
): Promise<DriveImportedFile | null> {
  if (!metadata.modifiedTime) {
    return null
  }

  const rows = await context.input.db
    .select({
      createdAt: schema.files.createdAt,
      id: schema.files.id,
      storageKey: schema.files.storageKey,
      name: schema.files.name,
      size: schema.files.size,
      type: schema.files.type,
      source: schema.files.source,
      expiresAt: schema.files.expiresAt,
      textStatus: schema.files.textStatus,
      textBytes: schema.files.textBytes,
      textOmittedMedia: schema.files.textOmittedMedia,
      textOmittedCharts: schema.files.textOmittedCharts,
      externalSource: schema.files.externalSource,
      externalId: schema.files.externalId,
      externalModifiedAt: schema.files.externalModifiedAt,
    })
    .from(schema.files)
    .where(and(
      eq(schema.files.userId, context.input.userId),
      eq(schema.files.externalSource, 'google'),
      eq(schema.files.externalId, metadata.id),
      eq(schema.files.externalModifiedAt, metadata.modifiedTime),
      or(
        isNull(schema.files.expiresAt),
        gt(
          schema.files.expiresAt,
          new Date(Date.now() + REUSE_MIN_REMAINING_MS),
        ),
      ),
    ))
    .orderBy(desc(schema.files.createdAt))
    .limit(REUSE_CANDIDATE_LIMIT)

  const storage = useFileStorage()

  for (const { createdAt, ...file } of rows) {
    if (!isCopyNewerThanEdit(createdAt, metadata.modifiedTime)) {
      continue
    }

    if (await storage.head(file.storageKey)) {
      return file
    }
  }

  return null
}

function assertDownloadResult(
  result: GoogleDownloadResult,
): Uint8Array {
  if (result.ok) {
    return result.bytes
  }

  throw new DriveItemFailure(classifyDriveFailure(result.status, result.reason))
}

async function exportCopy(
  fileId: string,
  choice: DriveExportChoice,
  request: DriveRequestContext,
  maxBytes: number,
): Promise<{ bytes: Uint8Array, mediaType: string, extension: string }> {
  const primary = await exportDriveFile(fileId, choice.mimeType, {
    ...request,
    maxBytes,
  })

  if (primary.ok) {
    return {
      bytes: primary.bytes,
      mediaType: choice.mimeType,
      extension: choice.extension,
    }
  }

  const canFallBack = !!choice.fallback
    && isUnsupportedExportFailure(primary.status)

  if (!canFallBack || !choice.fallback) {
    throw new DriveItemFailure(
      classifyDriveFailure(primary.status, primary.reason),
    )
  }

  const fallback = await exportDriveFile(fileId, choice.fallback.mimeType, {
    ...request,
    maxBytes,
  })

  return {
    bytes: assertDownloadResult(fallback),
    mediaType: choice.fallback.mimeType,
    extension: choice.fallback.extension,
  }
}

async function copyBytes(
  context: ItemContext,
  metadata: DriveFileMetadata,
  plan: CopyPlan,
  maxBytes: number,
): Promise<{ bytes: Uint8Array, mediaType: string, fileName: string }> {
  if (!plan.exportChoice) {
    const result = await downloadDriveFile(metadata.id, {
      ...context.request,
      maxBytes,
    })

    return {
      bytes: assertDownloadResult(result),
      mediaType: plan.mediaType,
      fileName: plan.fileName,
    }
  }

  const exported = await exportCopy(
    metadata.id,
    plan.exportChoice,
    context.request,
    maxBytes,
  )

  return {
    bytes: exported.bytes,
    mediaType: exported.mediaType,
    fileName: exported.extension === plan.exportChoice.extension
      ? plan.fileName
      : buildDriveCopyName(metadata.name, {
        extension: exported.extension,
        nameSuffix: plan.exportChoice.nameSuffix,
      }),
  }
}

async function importOne(
  context: ItemContext,
): Promise<DriveImportItemResult> {
  const { item } = context
  const metadataResult = await fetchDriveFileMetadata(item.id, context.request)

  if (!metadataResult.ok) {
    return failed(
      item.id,
      classifyDriveFailure(metadataResult.status, metadataResult.reason),
    )
  }

  const metadata = metadataResult.metadata

  if (metadata.trashed) {
    return failed(item.id, 'not_found')
  }

  return await copyFromMetadata(context, metadata)
}

async function copyFromMetadata(
  context: ItemContext,
  metadata: DriveFileMetadata,
): Promise<DriveImportItemResult> {
  const { input, item } = context
  const plan = await planCopy(context, metadata)
  const reusable = await findReusableCopy(context, metadata)

  if (reusable) {
    return { id: item.id, status: 'reused', file: reusable, note: plan.note }
  }

  const [policy, usedBytes] = await Promise.all([
    getEffectiveUserFilePolicy(input.userId, input.db),
    getUserStorageUsageBytes(input.userId, input.db),
  ])
  const remainingBytes = Math.max(policy.maxStorageBytes - usedBytes, 0)
  const formatMaxBytes = plan.exportChoice
    ? GOOGLE_DRIVE_EXPORT_MAX_BYTES
    : GOOGLE_DRIVE_FILE_MAX_BYTES
  const maxBytes = Math.min(formatMaxBytes, input.maxBytes ?? formatMaxBytes)

  if (remainingBytes <= 0) {
    return failed(item.id, 'storage_full')
  }

  if (metadata.size !== null && !plan.exportChoice) {
    if (metadata.size > maxBytes) {
      return failed(item.id, 'too_large')
    }

    if (metadata.size > remainingBytes) {
      return failed(item.id, 'storage_full')
    }
  }

  const streamCap = Math.min(maxBytes, remainingBytes)
  let copy: Awaited<ReturnType<typeof copyBytes>>

  try {
    copy = await copyBytes(context, metadata, plan, streamCap)
  } catch (exception) {
    if (
      (exception as { code?: unknown }).code
      === GOOGLE_DOWNLOAD_TOO_LARGE_CODE
    ) {
      if (remainingBytes < maxBytes) {
        return failed(item.id, 'storage_full')
      }

      return failed(
        item.id,
        plan.exportChoice ? 'export_too_large' : 'too_large',
      )
    }

    throw exception
  }

  if (copy.bytes.byteLength === 0) {
    return failed(item.id, 'empty')
  }

  if (plan.officeFormat) {
    try {
      assertOfficeUploadBytes(copy.fileName, plan.officeFormat, copy.bytes)
    } catch {
      return failed(item.id, 'unsupported_type')
    }
  }

  const stored = await persistFile({
    userId: input.userId,
    fileName: copy.fileName,
    mediaType: copy.mediaType,
    fileData: copy.bytes,
    source: 'upload',
    externalSource: 'google',
    externalId: metadata.id,
    externalModifiedAt: metadata.modifiedTime,
    logger: input.logger,
    policy,
    totalFilesSize: usedBytes,
  })

  return {
    id: item.id,
    status: 'imported',
    file: {
      ...stored,
      externalSource: 'google',
      externalId: metadata.id,
      externalModifiedAt: metadata.modifiedTime,
    },
    note: plan.note,
  }
}

function classifyItemException(
  context: ItemContext,
  exception: unknown,
): DriveImportFailureCode {
  if (exception instanceof DriveItemFailure) {
    return exception.code
  }

  if (isStorageFullError(exception)) {
    return 'storage_full'
  }

  context.input.logger.set({
    attributes: {
      googleDrive: {
        itemError: exceptionMessage(exception),
      },
    },
  })

  return 'failed'
}

async function importGuarded(
  context: ItemContext,
): Promise<DriveImportItemResult> {
  try {
    return await importOne(context)
  } catch (exception) {
    return failed(context.item.id, classifyItemException(context, exception))
  }
}

type ItemToken
  = | { status: 'ok', accessToken: string }
    | { status: 'unavailable' | 'reauthorize' }

/**
 * A token for one item. A refresh that fails with a Google 5xx or a busy
 * lock (the token module throws, and changes nothing) fails only this item,
 * so copies already stored are still reported to the user.
 */
async function readItemToken(
  input: Pick<DriveImportInput, 'db' | 'kv' | 'userId' | 'logger'>,
): Promise<ItemToken> {
  try {
    const token = await getGoogleAccessToken({
      userId: input.userId,
      clientMode: 'besidka',
      requiredScopes: [GOOGLE_SCOPES.driveFile],
    }, { db: input.db, kv: input.kv, logger: input.logger })

    return token.status === 'ok'
      ? { status: 'ok', accessToken: token.accessToken }
      : { status: 'reauthorize' }
  } catch (exception) {
    input.logger.set({
      attributes: {
        googleDrive: { tokenError: exceptionMessage(exception) },
      },
    })

    return { status: 'unavailable' }
  }
}

/**
 * Copies the files the user picked into Besidka's own storage, one at a
 * time (Workers allow six simultaneous connections, and each copy holds
 * Google and R2 connections). Each item gets a fresh token from
 * `getGoogleAccessToken`, so a long import never uses a token past its
 * life; a token that is no longer available fails the item as
 * `reauthorize`. Partial success is normal: every item has its own result.
 */
export async function importDriveFiles(
  input: DriveImportInput,
): Promise<DriveImportItemResult[]> {
  const results: DriveImportItemResult[] = []

  for (const item of input.items) {
    const token = await readItemToken(input)

    if (token.status !== 'ok') {
      results.push(failed(
        item.id,
        token.status === 'unavailable' ? 'failed' : 'reauthorize',
      ))

      continue
    }

    results.push(await importGuarded({
      input,
      item,
      request: {
        accessToken: token.accessToken,
        resourceKey: item.resourceKey,
      },
    }))
  }

  const failures: Record<string, number> = {}

  for (const result of results) {
    if (result.status === 'failed') {
      failures[result.code] = (failures[result.code] ?? 0) + 1
    }
  }

  input.logger.set({
    attributes: {
      googleDrive: {
        items: results.length,
        imported: results.filter(result => result.status === 'imported').length,
        reused: results.filter(result => result.status === 'reused').length,
        failures,
      },
    },
  })

  return results
}

export interface DriveRefreshInput {
  event: Pick<RequestEvent, 'context'>
  db: DbClient
  kv: KVNamespace
  userId: number
  fileIds: readonly string[]
  logger: LoggerLike
}

interface RefreshTarget {
  fileId: string
  driveId: string
  copiedModifiedAt: Date | null
}

function refreshFailed(
  id: string,
  code: DriveRefreshFailureCode,
): DriveRefreshItemResult {
  return {
    id,
    status: 'failed',
    code,
    reason: getDriveRefreshFailureReason(code),
  }
}

function isPublicFileId(value: string): boolean {
  const decoded = decodePublicId(value)

  return Number.isSafeInteger(decoded) && decoded > 0
}

function isSameModifiedSecond(
  copiedModifiedAt: Date | null,
  currentModifiedAt: Date | null,
): boolean {
  if (!copiedModifiedAt || !currentModifiedAt) {
    return false
  }

  return Math.floor(copiedModifiedAt.getTime() / 1000)
    === Math.floor(currentModifiedAt.getTime() / 1000)
}

async function findRefreshTargets(
  input: DriveRefreshInput,
): Promise<Map<string, RefreshTarget>> {
  const targets = new Map<string, RefreshTarget>()
  const candidateIds = input.fileIds.filter(isPublicFileId)

  if (candidateIds.length === 0) {
    return targets
  }

  const rows = await input.db
    .select({
      id: schema.files.id,
      externalId: schema.files.externalId,
      externalModifiedAt: schema.files.externalModifiedAt,
    })
    .from(schema.files)
    .where(and(
      eq(schema.files.userId, input.userId),
      inArray(schema.files.externalSource, GOOGLE_EXTERNAL_SOURCES),
      inArray(schema.files.id, candidateIds),
    ))

  for (const row of rows) {
    if (!isDriveFileId(row.externalId)) {
      continue
    }

    targets.set(row.id, {
      fileId: row.id,
      driveId: row.externalId,
      copiedModifiedAt: row.externalModifiedAt,
    })
  }

  return targets
}

function toRefreshResult(
  fileId: string,
  result: DriveImportItemResult,
): DriveRefreshItemResult {
  if (result.status === 'failed') {
    return refreshFailed(fileId, result.code)
  }

  return {
    id: fileId,
    status: result.status === 'imported' ? 'updated' : 'newer_copy',
    file: result.file,
    note: result.note,
  }
}

async function refreshOne(
  context: ItemContext,
  target: RefreshTarget,
): Promise<DriveRefreshItemResult> {
  try {
    const metadataResult = await fetchDriveFileMetadata(
      target.driveId,
      context.request,
    )

    if (!metadataResult.ok) {
      const code = classifyDriveFailure(
        metadataResult.status,
        metadataResult.reason,
      )

      return refreshFailed(
        target.fileId,
        code === 'not_found' ? 'no_access' : code,
      )
    }

    const metadata = metadataResult.metadata

    if (metadata.trashed) {
      return refreshFailed(target.fileId, 'deleted')
    }

    if (!metadata.modifiedTime) {
      return refreshFailed(target.fileId, 'unknown_version')
    }

    if (isSameModifiedSecond(target.copiedModifiedAt, metadata.modifiedTime)) {
      return { id: target.fileId, status: 'up_to_date' }
    }

    return toRefreshResult(
      target.fileId,
      await copyFromMetadata(context, metadata),
    )
  } catch (exception) {
    return refreshFailed(
      target.fileId,
      classifyItemException(context, exception),
    )
  }
}

/**
 * Checks the Drive original of each Google copy and copies it again when it
 * changed since the copy was made. One Google metadata call per copy, one
 * copy at a time, a fresh token for each. A copy is never rewritten in
 * place: a changed original becomes a new copy and the selected one stays
 * with the messages that used it (`newer_copy` when a copy of the current
 * version already exists). A file that is not the user's own Google copy
 * fails before any Google call.
 */
export async function refreshDriveCopies(
  input: DriveRefreshInput,
): Promise<DriveRefreshItemResult[]> {
  const targets = await findRefreshTargets(input)
  const results: DriveRefreshItemResult[] = []

  for (const fileId of input.fileIds) {
    const target = targets.get(fileId)

    if (!target) {
      results.push(refreshFailed(fileId, 'not_a_copy'))

      continue
    }

    const token = await readItemToken(input)

    if (token.status !== 'ok') {
      results.push(refreshFailed(
        fileId,
        token.status === 'unavailable' ? 'failed' : 'reauthorize',
      ))

      continue
    }

    results.push(await refreshOne({
      input: { ...input, items: [] },
      item: { id: target.driveId },
      request: { accessToken: token.accessToken },
    }, target))
  }

  const failures: Record<string, number> = {}

  for (const result of results) {
    if (result.status === 'failed') {
      failures[result.code] = (failures[result.code] ?? 0) + 1
    }
  }

  input.logger.set({
    attributes: {
      googleDrive: {
        refreshItems: results.length,
        updated: results.filter(result => result.status === 'updated').length,
        newerCopy: results.filter((result) => {
          return result.status === 'newer_copy'
        }).length,
        upToDate: results.filter((result) => {
          return result.status === 'up_to_date'
        }).length,
        refreshFailures: failures,
      },
    },
  })

  return results
}
