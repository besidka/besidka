import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  OFFICE_TEXT_MAX_BYTES,
  OFFICE_TEXT_VERSION,
  getOfficeFormatByMediaType,
  getOfficeTextStorageKey,
  isOfficeMediaType,
} from '#shared/utils/office-files'
import type { OfficeTextStatus } from '#shared/utils/office-files'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { extractOfficeText } from '~~/server/utils/documents/renderer'

const RENDERER_UNAVAILABLE_CODE = 'renderer_unavailable'
const SIDECAR_CONTENT_TYPE = 'text/markdown; charset=utf-8'
const SIDECAR_SLACK_BYTES = 4 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface OfficeTextState {
  textStatus: OfficeTextStatus
  textBytes: number | null
  textVersion: number
}

export interface OfficeTextFile {
  id: string
  userId: number
  storageKey: string
  type: string
  textStatus?: string | null
  textBytes?: number | null
  textVersion?: number | null
}

export interface StoreOfficeTextInput {
  fileId: string
  userId: number
  storageKey: string
  mediaType: string
  bytes: Uint8Array
  logger: LoggerLike
}

export interface LoadedOfficeText {
  text: string
  textBytes: number
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
 * Whether the stored extraction is missing or was made by an older extractor,
 * so the next send reads the file once and caches the result.
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
    const result = await extractOfficeText(
      { format, bytes: input.bytes },
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

    let textStatus: OfficeTextStatus = result.status
    let textBytes: number | null = null

    if (result.status === 'ready') {
      textBytes = await writeSidecar(input.storageKey, result.text)
      textStatus = textBytes === null ? 'too_large' : 'ready'
    }

    const state: OfficeTextState = {
      textStatus,
      textBytes,
      textVersion: OFFICE_TEXT_VERSION,
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
      truncated: result.truncated,
      errorCode: result.errorCode,
    })

    return state
  } catch (exception) {
    logOfficeText(input.logger, {
      format,
      status: 'error',
      error: exceptionMessage(exception),
    })

    return null
  }
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
  })
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
    return {
      textStatus: file.textStatus as OfficeTextStatus,
      textBytes: file.textBytes ?? null,
      textVersion: file.textVersion ?? OFFICE_TEXT_VERSION,
    }
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

    if (text === null) {
      const refreshed = await extractFromStoredFile(file, logger)

      if (refreshed?.textStatus !== 'ready') {
        return null
      }

      text = await readSidecar(file.storageKey)
    }

    return text === null
      ? null
      : { text, textBytes: encoder.encode(text).byteLength }
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
