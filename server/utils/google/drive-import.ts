import { and, desc, eq, gt, gte, inArray, isNull, or } from 'drizzle-orm'
import type { KVNamespace } from '@cloudflare/workers-types'
import type { RequestEvent } from 'nuxt/server'
import {
  GOOGLE_DRIVE_EXPORTS,
  GOOGLE_DRIVE_EXPORT_MAX_BYTES,
  GOOGLE_DRIVE_FILE_MAX_BYTES,
  buildDriveCopyName,
  describeDriveFailure,
  getDriveRefreshFailureReason,
  isDriveFileId,
  isDriveFolder,
  isGoogleNativeMimeType,
  readDriveGoogleReason,
  sanitizeDriveFileName,
} from '#shared/utils/google-drive'
import type {
  DriveExportChoice,
  DriveGoogleDetail,
  DriveImportFailureCode,
  DriveImportItemResult,
  DriveImportRequestItem,
  DriveImportedFile,
  DriveRefreshFailureCode,
  DriveRefreshItemResult,
  DriveRequestStage,
} from '#shared/utils/google-drive'
import { GOOGLE_EXTERNAL_SOURCES } from '#shared/utils/google-data-policy'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import {
  GOOGLE_FIRST_TAB_NOTE,
  GOOGLE_FIRST_TAB_UNKNOWN_COUNT_NOTE,
  GOOGLE_WORKBOOK_MAP_CHOICE,
  GOOGLE_WORKBOOK_MAP_MEDIA_TYPE,
  describeTabsImported,
} from '#shared/utils/google-sheets'
import type { DriveSheetsFallback } from '#shared/utils/google-sheets'
import {
  WORKBOOK_MAP_TEXT_VERSION,
} from '#shared/utils/office-files'
import type { OfficeFormat } from '#shared/utils/office-files'
import * as schema from '~~/server/db/schema'
import { decodePublicId } from '~~/server/utils/custom-db-types'
import { exceptionSummary } from '~~/server/utils/evlog-attributes'
import {
  getEffectiveUserFilePolicy,
  getUserStorageUsageBytes,
} from '~~/server/utils/files/file-governance'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { assertOfficeUploadBytes } from '~~/server/utils/files/office-upload-check'
import { toWorkbookTextSummary } from '~~/server/utils/files/office-text'
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
  DriveMetadataResult,
  DriveRequestContext,
} from '~~/server/utils/google/drive'
import { GOOGLE_DOWNLOAD_TOO_LARGE_CODE } from '~~/server/utils/google/download'
import type { GoogleDownloadResult } from '~~/server/utils/google/download'
import {
  createSheetsRequestReserver,
} from '~~/server/utils/google/sheets-rate-limit'
import type {
  SheetsRequestReserver,
} from '~~/server/utils/google/sheets-rate-limit'
import { readSpreadsheetMap } from '~~/server/utils/google/sheets-read'
import { getGoogleAccessToken } from '~~/server/utils/google/tokens'
import { isStorageFullError } from '~~/server/utils/storage/errors'

type DbClient = ReturnType<typeof useDb>

const REUSE_CANDIDATE_LIMIT = 3
const REUSE_MIN_REMAINING_MS = 60 * 60 * 1000
const FAILURE_DETAILS_LOGGED_MAX = 5

export const FRESH_PICK_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000]
export const FRESH_PICK_RETRY_BUDGET_MS = 6000

export interface DriveImportInput {
  event: Pick<RequestEvent, 'context'>
  db: DbClient
  kv: KVNamespace
  userId: number
  items: readonly DriveImportRequestItem[]
  logger: LoggerLike
  maxBytes?: number
  retryFreshPick?: boolean
  wait?: (milliseconds: number) => Promise<void>
  sheetsWallTimeMs?: number
  sheetsReserve?: SheetsRequestReserver
}

interface ItemContext {
  input: DriveImportInput
  item: DriveImportRequestItem
  request: DriveRequestContext
  retryBudget?: { remainingMs: number }
  sheetsLog?: string[]
}

const SPREADSHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet'
const CSV_MEDIA_TYPE = 'text/csv'

interface SheetsFallbackInfo {
  detail: DriveSheetsFallback
  tabsTotal: number | null
}

class DriveItemFailure extends Error {
  readonly code: DriveImportFailureCode
  readonly google?: DriveGoogleDetail

  constructor(code: DriveImportFailureCode, google?: DriveGoogleDetail) {
    super(code)
    this.code = code
    this.google = google
  }
}

function toGoogleDetail(
  stage: DriveRequestStage,
  status: number,
  reason: string | null,
): DriveGoogleDetail {
  return { stage, status, reason: readDriveGoogleReason(reason) }
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
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
  google?: DriveGoogleDetail,
): DriveImportItemResult {
  return {
    id,
    status: 'failed',
    code,
    reason: describeDriveFailure(code, google),
    ...(google ? { google } : {}),
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
 * apart from it. A Sheet has two kinds of copy: the workbook map (Markdown
 * with the workbook map text version) and the older first-tab CSV. `map`
 * reuses only the first, `csv` only the second, so an unchanged Sheet that
 * was copied as CSV before the map existed is copied again as a map, and a
 * CSV copy is reused only when the map cannot be read. A partial map has no
 * `external_modified_at` and never matches (see `copySpreadsheetAsMap`).
 */
async function findReusableCopy(
  context: ItemContext,
  metadata: DriveFileMetadata,
  kind: 'any' | 'map' | 'csv' = 'any',
): Promise<DriveImportedFile | null> {
  if (!metadata.modifiedTime) {
    return null
  }

  const kindConditions = kind === 'map'
    ? [
      eq(schema.files.type, GOOGLE_WORKBOOK_MAP_MEDIA_TYPE),
      gte(schema.files.textVersion, WORKBOOK_MAP_TEXT_VERSION),
    ]
    : kind === 'csv' ? [eq(schema.files.type, CSV_MEDIA_TYPE)] : []

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
      textVersion: schema.files.textVersion,
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
      ...kindConditions,
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
  stage: DriveRequestStage,
): Uint8Array {
  if (result.ok) {
    return result.bytes
  }

  throw new DriveItemFailure(
    classifyDriveFailure(result.status, result.reason),
    toGoogleDetail(stage, result.status, result.reason),
  )
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
      toGoogleDetail('export', primary.status, primary.reason),
    )
  }

  const fallback = await exportDriveFile(fileId, choice.fallback.mimeType, {
    ...request,
    maxBytes,
  })

  return {
    bytes: assertDownloadResult(fallback, 'export'),
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
      bytes: assertDownloadResult(result, 'download'),
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

/**
 * The metadata read of a file the user has just picked. Google can answer
 * 404 for a moment before the grant of a fresh pick is visible, so a 404 is
 * asked again after 0.5, 1 and 2 seconds, one request at a time, and only
 * when the caller says the file is a fresh pick. Any other answer, and a 404
 * of a file that was not just picked, is final. The waits of all files of one
 * request come out of one budget of 6 seconds, so ten files that all answer
 * 404 cost 6 seconds of waiting, not ten times 3.5.
 */
async function fetchPickedMetadata(
  context: ItemContext,
): Promise<DriveMetadataResult & { retries: number }> {
  const delays = context.input.retryFreshPick
    ? FRESH_PICK_RETRY_DELAYS_MS
    : []
  const wait = context.input.wait ?? waitFor
  let result = await fetchDriveFileMetadata(
    context.item.id,
    context.request,
  )
  let retries = 0

  for (const delay of delays) {
    const budget = context.retryBudget

    if (result.ok || result.status !== 404) {
      break
    }

    if (!budget || budget.remainingMs < delay) {
      break
    }

    budget.remainingMs -= delay
    await wait(delay)
    retries += 1
    result = await fetchDriveFileMetadata(context.item.id, context.request)
  }

  return { ...result, retries }
}

async function importOne(
  context: ItemContext,
): Promise<DriveImportItemResult> {
  const { item } = context
  const metadataResult = await fetchPickedMetadata(context)

  if (metadataResult.retries > 0) {
    context.input.logger.set({
      attributes: {
        googleDrive: { metadataRetries: metadataResult.retries },
      },
    })
  }

  if (!metadataResult.ok) {
    return failed(
      item.id,
      classifyDriveFailure(metadataResult.status, metadataResult.reason),
      toGoogleDetail(
        'metadata',
        metadataResult.status,
        metadataResult.reason,
      ),
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
  const isSpreadsheet = metadata.mimeType === SPREADSHEET_MIME_TYPE
  let fallback: SheetsFallbackInfo | null = null

  if (isSpreadsheet) {
    const mapCopy = await copySpreadsheetAsMap(context, metadata)

    if (mapCopy.result) {
      return mapCopy.result
    }

    fallback = mapCopy.fallback
  }

  const reusable = await findReusableCopy(
    context,
    metadata,
    isSpreadsheet ? 'csv' : 'any',
  )
  const notice = copyNotice(plan, fallback)

  if (reusable) {
    return { id: item.id, status: 'reused', file: reusable, ...notice }
  }

  const { policy, usedBytes } = await loadQuota(input)
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
    ...notice,
  }
}

function copyNotice(
  plan: CopyPlan,
  fallback: SheetsFallbackInfo | null,
): { note?: string, sheets?: DriveSheetsFallback } {
  if (!fallback) {
    return { note: plan.note }
  }

  if (fallback.tabsTotal === null) {
    return {
      note: GOOGLE_FIRST_TAB_UNKNOWN_COUNT_NOTE,
      sheets: { ...fallback.detail, isTabCountUnknown: true },
    }
  }

  return {
    ...(fallback.tabsTotal === 1 ? {} : { note: GOOGLE_FIRST_TAB_NOTE }),
    sheets: fallback.detail,
  }
}

async function loadQuota(input: DriveImportInput) {
  const [policy, usedBytes] = await Promise.all([
    getEffectiveUserFilePolicy(input.userId, input.db),
    getUserStorageUsageBytes(input.userId, input.db),
  ])

  return { policy, usedBytes }
}

type SpreadsheetMapCopy
  = | { result: DriveImportItemResult, fallback?: undefined }
    | { result?: undefined, fallback: SheetsFallbackInfo }

function logSheetsRun(context: ItemContext, entry: string) {
  context.sheetsLog?.push(entry)
}

/**
 * The first try of a Google Sheet: an unchanged map copy is reused; if
 * there is none, the Sheets API is read into a workbook map and stored as
 * Markdown the row of which says, in its own columns, that it is a map. A
 * map that cannot be read at all (the structure request fails, or no tab's
 * cells arrive) is not an error: the result says why and the caller makes
 * the first-tab CSV copy as before. Storage is checked before the read and
 * again against the size of the map.
 *
 * A partial map (fewer tabs imported than the Sheet has: a Google error,
 * the time budget, a rate limit, a tab that is too large or the 20-tab
 * limit) is stored with no `external_modified_at`. The reuse query matches
 * on that column, so a partial copy is never reused, and a refresh treats
 * it as outdated. The next import of the unchanged Sheet reads again and
 * tells the user "Only N of M tabs" again; a complete map from a later try
 * is stored with the Sheet's version and reused from then on. The cost is
 * that a Sheet with a tab that can never be read is read at every pick.
 */
async function copySpreadsheetAsMap(
  context: ItemContext,
  metadata: DriveFileMetadata,
): Promise<SpreadsheetMapCopy> {
  const { input, item } = context
  const reusable = await findReusableCopy(context, metadata, 'map')

  if (reusable) {
    return {
      result: { id: item.id, status: 'reused', file: reusable },
    }
  }

  const { policy, usedBytes } = await loadQuota(input)
  const remainingBytes = Math.max(policy.maxStorageBytes - usedBytes, 0)

  if (remainingBytes <= 0) {
    return { result: failed(item.id, 'storage_full') }
  }

  const read = await readSpreadsheetMap({
    spreadsheetId: metadata.id,
    accessToken: context.request.accessToken,
    ...(context.request.resourceKey
      ? { resourceKey: context.request.resourceKey }
      : {}),
    reserve: input.sheetsReserve
      ?? createSheetsRequestReserver(input.kv, input.userId),
    ...(input.sheetsWallTimeMs ? { wallTimeMs: input.sheetsWallTimeMs } : {}),
    ...(context.request.fetchImpl
      ? { fetchImpl: context.request.fetchImpl }
      : {}),
  })
  const { diagnostics } = read

  logSheetsRun(
    context,
    `${read.ok ? 'map' : `fallback:${read.fallback.code}`}`
    + `:requests=${diagnostics.requests}:bytes=${diagnostics.bytes}`
    + `:notRead=${diagnostics.tabsNotRead}:kv=${diagnostics.kvUnavailable}`
    + (diagnostics.failures.length > 0
      ? `:${diagnostics.failures.join('|')}`
      : ''),
  )

  if (!read.ok) {
    return {
      fallback: { detail: read.fallback, tabsTotal: read.tabsTotal },
    }
  }

  const bytes = new TextEncoder().encode(read.text)

  if (bytes.byteLength > remainingBytes) {
    return { result: failed(item.id, 'storage_full') }
  }

  const copiedModifiedAt = read.tabsImported < read.tabsTotal
    ? null
    : metadata.modifiedTime
  const stored = await persistFile({
    userId: input.userId,
    fileName: buildDriveCopyName(metadata.name, GOOGLE_WORKBOOK_MAP_CHOICE),
    mediaType: GOOGLE_WORKBOOK_MAP_MEDIA_TYPE,
    fileData: bytes,
    source: 'upload',
    externalSource: 'google',
    externalId: metadata.id,
    externalModifiedAt: copiedModifiedAt,
    workbookMap: { summary: toWorkbookTextSummary(read.summary) },
    logger: input.logger,
    policy,
    totalFilesSize: usedBytes,
  })
  const note = describeTabsImported(read.tabsImported, read.tabsTotal)

  return {
    result: {
      id: item.id,
      status: 'imported',
      file: {
        ...stored,
        externalSource: 'google',
        externalId: metadata.id,
        externalModifiedAt: copiedModifiedAt,
      },
      ...(note ? { note } : {}),
    },
  }
}

function classifyItemException(
  context: ItemContext,
  exception: unknown,
): { code: DriveImportFailureCode, google?: DriveGoogleDetail } {
  if (exception instanceof DriveItemFailure) {
    return { code: exception.code, google: exception.google }
  }

  if (isStorageFullError(exception)) {
    return { code: 'storage_full' }
  }

  context.input.logger.set({
    attributes: {
      googleDrive: {
        itemError: 'failed',
        ...exceptionSummary(exception),
      },
    },
  })

  return { code: 'failed' }
}

async function importGuarded(
  context: ItemContext,
): Promise<DriveImportItemResult> {
  try {
    return await importOne(context)
  } catch (exception) {
    const { code, google } = classifyItemException(context, exception)

    return failed(context.item.id, code, google)
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
        googleDrive: {
          tokenError: 'failed',
          ...exceptionSummary(exception),
        },
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
  const retryBudget = { remainingMs: FRESH_PICK_RETRY_BUDGET_MS }
  const sheetsLog: string[] = []

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
      retryBudget,
      sheetsLog,
    }))
  }

  const failures: Record<string, number> = {}
  const failureDetails: string[] = []

  for (const result of results) {
    if (result.status === 'failed') {
      failures[result.code] = (failures[result.code] ?? 0) + 1

      if (
        result.google
        && failureDetails.length < FAILURE_DETAILS_LOGGED_MAX
      ) {
        failureDetails.push(
          `${result.google.stage}:${result.google.status}:`
          + `${result.google.reason ?? 'none'}`,
        )
      }
    }
  }

  input.logger.set({
    attributes: {
      googleDrive: {
        items: results.length,
        imported: results.filter(result => result.status === 'imported').length,
        reused: results.filter(result => result.status === 'reused').length,
        failures,
        failureDetails,
        ...(sheetsLog.length > 0
          ? { sheetsDetails: sheetsLog.slice(0, FAILURE_DETAILS_LOGGED_MAX) }
          : {}),
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
    ...(result.sheets ? { sheets: result.sheets } : {}),
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
      classifyItemException(context, exception).code,
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
  const sheetsLog: string[] = []

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
      sheetsLog,
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
        ...(sheetsLog.length > 0
          ? { sheetsDetails: sheetsLog.slice(0, FAILURE_DETAILS_LOGGED_MAX) }
          : {}),
      },
    },
  })

  return results
}
