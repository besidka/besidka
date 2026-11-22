import { and, eq } from 'drizzle-orm'
import { readZipDirectory } from '@besidka/doc-renderer/zip'
import * as schema from '~~/server/db/schema'
import type { WorkbookMapSummary } from '@besidka/doc-renderer/workbook-map'
import {
  OFFICE_TEXT_INLINE_MAX_BYTES,
  OFFICE_TEXT_MAX_BYTES,
  OFFICE_TEXT_VERSION,
  WORKBOOK_MAP_TEXT_VERSION,
  WORKBOOK_SUMMARY_SHEETS_MAX,
  getOfficeFormatByMediaType,
  getOfficeTextStorageKey,
  getOfficeTextVersion,
  isOfficeMediaType,
} from '#shared/utils/office-files'
import type {
  OfficeFormat,
  OfficeTextStatus,
  WorkbookTextSummary,
} from '#shared/utils/office-files'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  WORKBOOK_MAP_EXTRACT_VERSION,
  extractOfficeText,
  rendererOffersWorkbookMap,
} from '~~/server/utils/documents/renderer'
import type { ExtractResult } from '~~/workers/doc-renderer/src/contract'
import { OFFICE_UPLOAD_ZIP_LIMITS } from '~~/server/utils/files/office-upload-check'

const RENDERER_UNAVAILABLE_CODE = 'renderer_unavailable'
const UPGRADE_FAILED_PREFIX = 'office-text-upgrade-failed:'
const UPGRADE_FAILED_TTL_SECONDS = 7 * 24 * 60 * 60
const SIDECAR_CONTENT_TYPE = 'text/markdown; charset=utf-8'
const SIDECAR_SLACK_BYTES = 4 * 1024
export const OFFICE_OMITTED_COUNT_MAX = 99
const OMITTED_MEDIA_ENTRY = /^(?:word|ppt|xl)\/(?:media|embeddings)\/.*[^/]$/
const CHART_DATA_WORKBOOK_ENTRY
  = /^(?:word|ppt|xl)\/embeddings\/.*\.(?:xlsx|xlsm|xlsb|xls)$/i
const OMITTED_CHART_ENTRY
  = /^(?:word|ppt|xl)\/(?:charts\/chart|diagrams\/data)[^/]*\.xml$/
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface OfficeOmittedCounts {
  media: number
  charts: number
}

export interface OfficeTextState {
  textStatus: OfficeTextStatus
  textBytes: number | null
  textVersion: number
  textOmittedMedia: number | null
  textOmittedCharts: number | null
  workbookSummary?: WorkbookTextSummary | null
}

const SUMMARY_SHEET_NAME_MAX = 64
const SUMMARY_CUTS_MAX = 20

export interface OfficeTextFile {
  id: string
  userId: number
  storageKey: string
  type: string
  textStatus?: string | null
  textBytes?: number | null
  textVersion?: number | null
  textOmittedMedia?: number | null
  textOmittedCharts?: number | null
}

export interface StoreOfficeTextInput {
  fileId: string
  userId: number
  storageKey: string
  mediaType: string
  bytes: Uint8Array
  logger: LoggerLike
  isUpgrade?: boolean
}

export interface LoadedOfficeText {
  text: string
  textBytes: number
  textVersion: number
}

/**
 * The KV key that remembers a failed workbook map upgrade of a stored
 * spreadsheet for 7 days, so a send does not read the file again each
 * time. Deleted with the file by `invalidateFileCache`.
 */
export function getOfficeTextUpgradeFailedKey(storageKey: string): string {
  return `${UPGRADE_FAILED_PREFIX}${storageKey}`
}

function logOfficeText(
  logger: LoggerLike,
  fields: Record<string, unknown>,
): void {
  logger.set({
    attributes: {
      files: {
        officeText: fields,
      },
    },
  })
}

/**
 * Counts the parts of an Office package that the extracted text leaves out,
 * from entry names only: images and embedded objects as `media`, charts and
 * diagrams as `charts`. An embedded spreadsheet is the data behind a chart,
 * not a picture, so it counts as neither. Each count is capped so a hostile
 * file cannot inflate it.
 */
export function countOmittedOfficeEntries(
  names: readonly string[],
): OfficeOmittedCounts {
  let media = 0
  let charts = 0

  for (const name of names) {
    if (CHART_DATA_WORKBOOK_ENTRY.test(name)) {
      continue
    }

    if (OMITTED_MEDIA_ENTRY.test(name)) {
      media += 1
    } else if (OMITTED_CHART_ENTRY.test(name)) {
      charts += 1
    }
  }

  return {
    media: Math.min(media, OFFICE_OMITTED_COUNT_MAX),
    charts: Math.min(charts, OFFICE_OMITTED_COUNT_MAX),
  }
}

/**
 * Reads the ZIP central directory (names only, nothing is inflated) and
 * counts what the text leaves out. An archive that cannot be read counts as
 * nothing omitted, so a file is never re-read on every send; NULL columns
 * only ever mean "not counted yet".
 */
export function countOmittedOfficeContent(
  bytes: Uint8Array,
): OfficeOmittedCounts | null {
  const directory = readZipDirectory(bytes, OFFICE_UPLOAD_ZIP_LIMITS)

  if (!directory.ok) {
    return null
  }

  return countOmittedOfficeEntries(
    directory.directory.entries.map(entry => entry.name),
  )
}

/**
 * Whether there is no usable stored extraction, so the next send must read
 * the file once and cache the result.
 */
export function needsOfficeTextExtraction(file: {
  type: string
  textStatus?: string | null
  textVersion?: number | null
}): boolean {
  if (!isOfficeMediaType(file.type)) {
    return false
  }

  return !file.textStatus || (file.textVersion ?? 0) < OFFICE_TEXT_VERSION
}

/**
 * Whether a usable stored extraction comes from an older extractor than this
 * format now uses (a spreadsheet stored as plain values before the workbook
 * map). It is read again only while the bound renderer offers the newer
 * version; until then the stored text keeps being used.
 */
export function isOfficeTextUpgradable(file: {
  type: string
  textStatus?: string | null
  textVersion?: number | null
}): boolean {
  if (!isOfficeMediaType(file.type) || !file.textStatus) {
    return false
  }

  return (file.textVersion ?? 0) < getOfficeTextVersion(file.type)
}

/**
 * The part of the workbook map summary the attach chip needs, with sheet
 * names cut short. Sent to the client with the upload response, never
 * stored.
 */
export function toWorkbookTextSummary(
  summary: WorkbookMapSummary,
): WorkbookTextSummary {
  const valuesCut = summary.sheetSummaries
    .filter(sheet => typeof sheet.valuesCutAfterRow === 'number')
    .slice(0, WORKBOOK_SUMMARY_SHEETS_MAX)
    .map((sheet) => {
      return {
        sheet: sheet.name.slice(0, SUMMARY_SHEET_NAME_MAX),
        afterRow: sheet.valuesCutAfterRow as number,
      }
    })

  return {
    sheets: summary.sheets,
    sheetsTotal: summary.sheetsTotal,
    formulas: summary.formulas,
    rules: summary.validations + summary.conditionalRules,
    cut: summary.cut.slice(0, SUMMARY_CUTS_MAX),
    valuesCut,
  }
}

function storedTextVersion(
  format: OfficeFormat,
  result: ExtractResult,
  askedForMap: boolean,
): number {
  if (format !== 'xlsx') {
    return OFFICE_TEXT_VERSION
  }

  if (result.workbookMap) {
    return WORKBOOK_MAP_TEXT_VERSION
  }

  const isFailure = result.status === 'failed'
    || result.status === 'too_large'

  return askedForMap && isFailure
    ? WORKBOOK_MAP_TEXT_VERSION
    : OFFICE_TEXT_VERSION
}

async function writeSidecar(
  storageKey: string,
  text: string,
): Promise<number | null> {
  const encoded = encoder.encode(text)

  if (encoded.byteLength > OFFICE_TEXT_MAX_BYTES + SIDECAR_SLACK_BYTES) {
    return null
  }

  await useFileStorage().put(getOfficeTextStorageKey(storageKey), encoded, {
    httpMetadata: { contentType: SIDECAR_CONTENT_TYPE },
  })

  return encoded.byteLength
}

async function saveOfficeTextState(
  input: StoreOfficeTextInput,
  state: OfficeTextState,
): Promise<void> {
  await useDb()
    .update(schema.files)
    .set({
      textStatus: state.textStatus,
      textBytes: state.textBytes,
      textVersion: state.textVersion,
      textOmittedMedia: state.textOmittedMedia,
      textOmittedCharts: state.textOmittedCharts,
    })
    .where(and(
      eq(schema.files.id, input.fileId),
      eq(schema.files.userId, input.userId),
    ))
}

/**
 * Reads the text of a stored Office file through the renderer and keeps it:
 * Markdown in R2 next to the file (`<key>.text.md`) plus the status, size and
 * extractor version on the `files` row. It never throws, so a failure never
 * fails the upload or the send that triggered it. A renderer that is down
 * leaves the status empty (not `failed`), so the next send retries.
 */
export async function extractAndStoreOfficeText(
  input: StoreOfficeTextInput,
): Promise<OfficeTextState | null> {
  const format = getOfficeFormatByMediaType(input.mediaType)

  if (!format) {
    return null
  }

  try {
    const askedForMap = format === 'xlsx'
      && await rendererOffersWorkbookMap(input.logger)
    const result = await extractOfficeText(
      askedForMap
        ? {
          format,
          bytes: input.bytes,
          version: WORKBOOK_MAP_EXTRACT_VERSION,
          maxTextBytes: OFFICE_TEXT_INLINE_MAX_BYTES,
        }
        : { format, bytes: input.bytes },
      input.logger,
    )

    if (result.errorCode === RENDERER_UNAVAILABLE_CODE) {
      logOfficeText(input.logger, {
        format,
        status: 'unavailable',
        errorCode: result.errorCode,
      })

      return null
    }

    if (input.isUpgrade) {
      return await storeUpgrade(input, format, result, askedForMap)
    }

    let textStatus: OfficeTextStatus = result.status
    let textBytes: number | null = null

    if (result.status === 'ready') {
      textBytes = await writeSidecar(input.storageKey, result.text)
      textStatus = textBytes === null ? 'too_large' : 'ready'
    }

    const omitted = countOmittedOfficeContent(input.bytes)
    const state: OfficeTextState = {
      textStatus,
      textBytes,
      textVersion: storedTextVersion(format, result, askedForMap),
      textOmittedMedia: omitted?.media ?? 0,
      textOmittedCharts: omitted?.charts ?? 0,
    }

    try {
      await saveOfficeTextState(input, state)
    } catch (exception) {
      await discardSidecar(input.storageKey)
      throw exception
    }

    logOfficeText(input.logger, {
      format,
      status: textStatus,
      textBytes,
      textVersion: state.textVersion,
      truncated: result.truncated,
      errorCode: result.errorCode,
      omittedMedia: state.textOmittedMedia,
      omittedCharts: state.textOmittedCharts,
      omittedUnreadable: omitted === null,
    })

    return result.workbookMap
      ? { ...state, workbookSummary: toWorkbookTextSummary(result.workbookMap) }
      : state
  } catch (exception) {
    logOfficeText(input.logger, {
      format,
      status: 'error',
      error: exceptionMessage(exception),
    })

    return null
  }
}

async function rememberFailedUpgrade(
  storageKey: string,
  logger: LoggerLike,
): Promise<void> {
  try {
    await useKV().put(getOfficeTextUpgradeFailedKey(storageKey), '1', {
      expirationTtl: UPGRADE_FAILED_TTL_SECONDS,
    })
  } catch (exception) {
    logOfficeText(logger, {
      phase: 'upgrade',
      status: 'remember-failed',
      error: exceptionMessage(exception),
    })
  }
}

async function hasFailedUpgrade(
  storageKey: string,
  logger: LoggerLike,
): Promise<boolean> {
  try {
    const marker = await useKV().get(getOfficeTextUpgradeFailedKey(storageKey))

    return marker !== null
  } catch (exception) {
    logOfficeText(logger, {
      phase: 'upgrade',
      status: 'marker-unreadable',
      error: exceptionMessage(exception),
    })

    return false
  }
}

/**
 * The upgrade of a ready version 1 spreadsheet to the workbook map. Only a
 * ready map is stored; any other answer leaves the row and the version 1
 * text untouched, so the file stays readable. A failure that belongs to
 * the file (failed, too large, empty, or a map too big to store) is
 * remembered in KV for 7 days so later sends skip the read; a renderer
 * that is down or answers without a map is not remembered. A row update
 * that fails keeps the new sidecar, because the old text is already gone.
 */
async function storeUpgrade(
  input: StoreOfficeTextInput,
  format: OfficeFormat,
  result: ExtractResult,
  askedForMap: boolean,
): Promise<OfficeTextState | null> {
  if (!askedForMap) {
    return null
  }

  const isFileFailure = result.status !== 'ready'
  const textBytes = result.status === 'ready' && result.workbookMap
    ? await writeSidecar(input.storageKey, result.text)
    : null

  if (textBytes === null) {
    const remembers = isFileFailure || !!result.workbookMap

    if (remembers) {
      await rememberFailedUpgrade(input.storageKey, input.logger)
    }

    logOfficeText(input.logger, {
      format,
      phase: 'upgrade',
      status: result.status,
      errorCode: result.errorCode,
      kept: 'version-1',
      remembered: remembers,
    })

    return null
  }

  const omitted = countOmittedOfficeContent(input.bytes)
  const state: OfficeTextState = {
    textStatus: 'ready',
    textBytes,
    textVersion: WORKBOOK_MAP_TEXT_VERSION,
    textOmittedMedia: omitted?.media ?? 0,
    textOmittedCharts: omitted?.charts ?? 0,
  }

  await saveOfficeTextState(input, state)
  logOfficeText(input.logger, {
    format,
    phase: 'upgrade',
    status: 'ready',
    textBytes,
    textVersion: state.textVersion,
  })

  return result.workbookMap
    ? { ...state, workbookSummary: toWorkbookTextSummary(result.workbookMap) }
    : state
}

async function discardSidecar(storageKey: string): Promise<void> {
  try {
    await useFileStorage().delete([getOfficeTextStorageKey(storageKey)])
  } catch {
    return
  }
}

async function readSidecar(storageKey: string): Promise<string | null> {
  const object = await useFileStorage().get(getOfficeTextStorageKey(storageKey))

  if (!object) {
    return null
  }

  return decoder.decode(await object.arrayBuffer())
}

async function extractFromStoredFile(
  file: OfficeTextFile,
  logger: LoggerLike,
  isUpgrade = false,
): Promise<OfficeTextState | null> {
  const object = await useFileStorage().get(file.storageKey)

  if (!object) {
    return null
  }

  return extractAndStoreOfficeText({
    fileId: file.id,
    userId: file.userId,
    storageKey: file.storageKey,
    mediaType: file.type,
    bytes: new Uint8Array(await object.arrayBuffer()),
    logger,
    isUpgrade,
  })
}

async function upgradeOfficeText(
  file: OfficeTextFile,
  logger: LoggerLike,
): Promise<OfficeTextState | null> {
  try {
    return await extractFromStoredFile(file, logger, true)
  } catch (exception) {
    logOfficeText(logger, {
      status: 'error',
      phase: 'upgrade',
      error: exceptionMessage(exception),
    })

    return null
  }
}

function needsOmittedCounts(file: OfficeTextFile): boolean {
  return file.textStatus === 'ready'
    && file.textOmittedMedia == null
    && file.textOmittedCharts == null
}

/**
 * A ready file stored before the omitted-content counts existed gets them
 * from its ZIP directory on first use, without running the renderer or
 * rewriting the text. A failure leaves the counts empty and returns the
 * state as it was.
 */
async function backfillOmittedCounts(
  file: OfficeTextFile,
  state: OfficeTextState,
  logger: LoggerLike,
): Promise<OfficeTextState> {
  try {
    const object = await useFileStorage().get(file.storageKey)

    if (!object) {
      return state
    }

    const omitted = countOmittedOfficeContent(
      new Uint8Array(await object.arrayBuffer()),
    )
    const counted: OfficeTextState = {
      ...state,
      textOmittedMedia: omitted?.media ?? 0,
      textOmittedCharts: omitted?.charts ?? 0,
    }

    await useDb()
      .update(schema.files)
      .set({
        textOmittedMedia: counted.textOmittedMedia,
        textOmittedCharts: counted.textOmittedCharts,
      })
      .where(and(
        eq(schema.files.id, file.id),
        eq(schema.files.userId, file.userId),
      ))

    logOfficeText(logger, {
      status: 'counted',
      phase: 'backfill',
      omittedMedia: counted.textOmittedMedia,
      omittedCharts: counted.textOmittedCharts,
      omittedUnreadable: omitted === null,
    })

    return counted
  } catch (exception) {
    logOfficeText(logger, {
      status: 'error',
      phase: 'backfill',
      error: exceptionMessage(exception),
    })

    return state
  }
}

/**
 * The extraction state a send can rely on. A file stored before extraction
 * existed (or by an older extractor) is read once here and cached, so the
 * cost is paid on the first send only. Returns null when the state cannot be
 * established right now.
 */
export async function ensureOfficeTextState(
  file: OfficeTextFile,
  logger: LoggerLike,
): Promise<OfficeTextState | null> {
  if (!needsOfficeTextExtraction(file)) {
    const state: OfficeTextState = {
      textStatus: file.textStatus as OfficeTextStatus,
      textBytes: file.textBytes ?? null,
      textVersion: file.textVersion ?? OFFICE_TEXT_VERSION,
      textOmittedMedia: file.textOmittedMedia ?? null,
      textOmittedCharts: file.textOmittedCharts ?? null,
    }

    const canUpgrade = isOfficeTextUpgradable(file)
      && !await hasFailedUpgrade(file.storageKey, logger)
      && await rendererOffersWorkbookMap(logger)

    if (canUpgrade) {
      const upgraded = await upgradeOfficeText(file, logger)

      if (upgraded) {
        return upgraded
      }
    }

    if (needsOmittedCounts(file)) {
      return backfillOmittedCounts(file, state, logger)
    }

    return state
  }

  try {
    return await extractFromStoredFile(file, logger)
  } catch (exception) {
    logOfficeText(logger, {
      status: 'error',
      phase: 'lazy',
      error: exceptionMessage(exception),
    })

    return null
  }
}

/**
 * Loads the stored text for a file whose status is `ready`. A missing sidecar
 * (deleted, or never written because the write failed) triggers one
 * re-extraction before giving up.
 */
export async function loadOfficeText(
  file: OfficeTextFile,
  logger: LoggerLike,
): Promise<LoadedOfficeText | null> {
  try {
    const state = await ensureOfficeTextState(file, logger)

    if (state?.textStatus !== 'ready') {
      return null
    }

    let text = await readSidecar(file.storageKey)
    let { textVersion } = state

    if (text === null) {
      const refreshed = await extractFromStoredFile(file, logger)

      if (refreshed?.textStatus !== 'ready') {
        return null
      }

      textVersion = refreshed.textVersion
      text = await readSidecar(file.storageKey)
    }

    return text === null
      ? null
      : { text, textBytes: encoder.encode(text).byteLength, textVersion }
  } catch (exception) {
    logOfficeText(logger, {
      status: 'error',
      phase: 'load',
      error: exceptionMessage(exception),
    })

    return null
  }
}

export interface TruncatedText {
  text: string
  bytes: number
  truncated: boolean
}

/**
 * Cuts text to at most `maxBytes` of UTF-8 without splitting a character.
 */
export function truncateUtf8(text: string, maxBytes: number): TruncatedText {
  const bytes = encoder.encode(text)

  if (bytes.byteLength <= maxBytes) {
    return { text, bytes: bytes.byteLength, truncated: false }
  }

  let end = Math.max(0, maxBytes)

  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) {
    end -= 1
  }

  return {
    text: decoder.decode(bytes.subarray(0, end)),
    bytes: end,
    truncated: true,
  }
}
