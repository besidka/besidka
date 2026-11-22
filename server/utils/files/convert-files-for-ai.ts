import type { UIMessage } from 'ai'
import { useLogger } from 'evlog'
import { fitWorkbookMap } from '@besidka/doc-renderer/workbook-map'
import { normalizeMediaType } from '#shared/utils/files'
import { resolveFileDelivery } from '#shared/utils/file-delivery'
import { isGoogleWorkbookMapFile } from '#shared/utils/google-sheets'
import type { FileDeliveryReason } from '#shared/utils/file-delivery'
import {
  OFFICE_FORMAT_NOUNS,
  OFFICE_TEXT_INLINE_MAX_BYTES,
  OFFICE_TEXT_MESSAGE_MAX_BYTES,
  WORKBOOK_MAP_TEXT_VERSION,
  getOfficeFormatByMediaType,
  isOfficeMediaType,
} from '#shared/utils/office-files'
import type { OfficeFormat } from '#shared/utils/office-files'
import {
  CARRIED_TEXT_FILE_MAX_BYTES,
  extractStorageKeyFromFileUrl,
  getOwnedFilesByStorageKeys,
  getOwnedGeneratedImageFilesByStorageKeys,
} from '~~/server/utils/files/file-governance'
import type {
  CarriedStructureOnlyFile,
} from '~~/server/utils/files/assistant-files'
import {
  resolveServerLogger,
} from '~~/server/utils/files/logger'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  getOfficeTextUpgradeFailedKey,
  loadOfficeText,
  truncateUtf8,
} from '~~/server/utils/files/office-text'
import type { LoadedOfficeText } from '~~/server/utils/files/office-text'

export interface MissingFile {
  storageKey: string
  filename?: string
}

export interface UnsupportedFile {
  storageKey: string
  filename?: string
  reason: FileDeliveryReason | undefined
}

export interface ConversionResult {
  messages: UIMessage[]
  missingFiles: MissingFile[]
  unsupportedFiles: UnsupportedFile[]
}

const CACHE_TTL_SECONDS = 5 * 60
const FILE_CACHE_PREFIX = 'file-cache:'
const EXTRACTED_TEXT_NOTE
  = 'Extracted text. Images, charts and formatting are not included.'
const WORKBOOK_MAP_NOTE = 'Workbook map. Included: values, formulas, '
  + 'number formats, dropdown and validation rules, conditional formatting '
  + 'rules, merged cells and notes. Not included: colors, charts and images. '
  + 'Values are the results last calculated and saved in the file; they are '
  + 'not recalculated.'

const GOOGLE_SHEET_NOUN = 'Google Sheet'
const GOOGLE_WORKBOOK_MAP_NOTE = 'Workbook map of a Google Sheet. Included: '
  + 'the values as displayed, formulas as written in the Sheet, number '
  + 'formats, dropdown and validation rules, conditional formatting rules, '
  + 'merged cells and notes. Not included: colors, charts and images. Values '
  + 'are the ones the Sheet displayed when it was picked; they are not '
  + 'recalculated.'

const SHORTENED_MAP_NOTE = 'Values were shortened in this earlier '
  + 'attachment to fit: every formula and rule is included, and only the '
  + 'value tables that fit are. Ask the user to attach the file again for '
  + 'the full values.'

export interface ConvertFilesOptions {
  container?: {
    providerId: string
    messageId: string
  }
  structureOnlyFiles?: readonly CarriedStructureOnlyFile[]
}

function isStructureOnly(
  options: ConvertFilesOptions,
  messageId: string,
  storageKey: string,
): boolean {
  return (options.structureOnlyFiles ?? []).some((file) => {
    return file.messageId === messageId && file.storageKey === storageKey
  })
}

/**
 * The text an Office file is sent as, decided from the stored format and
 * text version, never from the text itself. A workbook map carried from an
 * earlier message is fitted to `CARRIED_TEXT_FILE_MAX_BYTES`.
 */
function officeTextToSend(
  officeText: LoadedOfficeText,
  mediaType: string,
  isCarriedStructureOnly: boolean,
): { text: string, isWorkbookMap: boolean, isShortened: boolean } {
  const isWorkbookMap = getOfficeFormatByMediaType(mediaType) === 'xlsx'
    && officeText.textVersion >= WORKBOOK_MAP_TEXT_VERSION

  if (!isWorkbookMap || !isCarriedStructureOnly) {
    return { text: officeText.text, isWorkbookMap, isShortened: false }
  }

  const text = fitWorkbookMap(officeText.text, CARRIED_TEXT_FILE_MAX_BYTES)

  return { text, isWorkbookMap, isShortened: text !== officeText.text }
}

/**
 * `options.container` names the "Run code" send (direct provider, files on)
 * and the id of the message whose files the sandbox receives. Only that
 * message's Office and JSON files may leave as a sandbox file part
 * (`inline`, Gemini) or as a note (`upload`, Anthropic and OpenAI, where the
 * route uploads them separately).
 */
export async function convertFilesForAI(
  messages: UIMessage[],
  options: ConvertFilesOptions = {},
): Promise<ConversionResult> {
  const logger = useLogger(useEvent())
  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)
  const missingFiles: MissingFile[] = []
  const unsupportedFiles: UnsupportedFile[] = []
  const storage = useFileStorage()
  const convertedMessages: UIMessage[] = []
  const storageKeysFromMessages: string[] = []

  for (const message of messages) {
    if (!Array.isArray(message.parts)) {
      continue
    }

    for (const part of message.parts) {
      if (part.type !== 'file' || part.url.startsWith('data:')) {
        continue
      }

      const storageKey = extractStorageKeyFromFileUrl(part.url)

      if (storageKey) {
        storageKeysFromMessages.push(storageKey)
      }
    }
  }

  const ownedFiles = await getOwnedFilesByStorageKeys(
    userId,
    storageKeysFromMessages,
  )

  for (const message of messages) {
    if (!Array.isArray(message.parts)) {
      convertedMessages.push(message)
      continue
    }

    const convertedParts: NonNullable<UIMessage['parts']>[number][] = []
    let officeBytesRemaining = OFFICE_TEXT_MESSAGE_MAX_BYTES

    for (const part of message.parts) {
      if (part.type !== 'file') {
        convertedParts.push(part)
        continue
      }

      if (part.url.startsWith('data:')) {
        convertedParts.push(part)
        continue
      }

      const storageKey = extractStorageKeyFromFileUrl(part.url)

      if (!storageKey) {
        logger.set({
          fileConversion: {
            reason: 'invalid-url',
          },
          attributes: {
            fileConversion: {
              url: part.url,
            },
          },
        })
        convertedParts.push(part)
        continue
      }

      const ownedFile = ownedFiles.get(storageKey)

      if (!ownedFile) {
        logger.set({
          fileConversion: {
            reason: 'forbidden-file-access',
            storageKey,
          },
        })
        missingFiles.push({
          storageKey,
          filename: part.filename,
        })
        continue
      }

      const mediaType = ownedFile.type ?? part.mediaType
      const isOffice = isOfficeMediaType(mediaType)
      const officeText = isOffice
        ? await loadOfficeText(
          { ...ownedFile, userId, type: mediaType },
          logger,
        )
        : null
      const isContainerMessage = options.container?.messageId === message.id
      const delivery = resolveFileDelivery({
        route: 'direct',
        providerId: isContainerMessage
          ? options.container?.providerId
          : undefined,
        codeExecutionFiles: isContainerMessage,
        mediaType,
        textStatus: isOffice ? (officeText ? 'ready' : 'failed') : undefined,
      })

      if (delivery.delivery === 'unsupported') {
        unsupportedFiles.push({
          storageKey,
          filename: part.filename,
          reason: delivery.reason,
        })
        convertedParts.push({
          type: 'text',
          text: formatUnsupportedFilePart(part.filename, delivery.reason),
        })
        continue
      }

      if (delivery.delivery === 'container' && delivery.container === 'upload') {
        convertedParts.push({
          type: 'text',
          text: formatSandboxFilePart(part.filename),
        })
        continue
      }

      if (officeText) {
        const sent = officeTextToSend(
          officeText,
          mediaType,
          isStructureOnly(options, message.id, storageKey),
        )
        const formatted = formatOfficeFilePart({
          filename: part.filename,
          mediaType,
          ...sent,
          remainingBytes: officeBytesRemaining,
        })

        officeBytesRemaining = formatted.remainingBytes
        convertedParts.push({ type: 'text', text: formatted.text })

        if (delivery.container !== 'inline') {
          continue
        }
      }

      if (delivery.delivery === 'text' && !officeText) {
        try {
          const textContent = await readStorageFileAsText(
            storage,
            storageKey,
            logger,
          )

          if (textContent === null) {
            missingFiles.push({
              storageKey,
              filename: part.filename,
            })
            continue
          }

          if (isGoogleWorkbookMapFile({ ...ownedFile, type: mediaType })) {
            const text = isStructureOnly(options, message.id, storageKey)
              ? fitWorkbookMap(textContent, CARRIED_TEXT_FILE_MAX_BYTES)
              : textContent
            const formatted = formatOfficeFilePart({
              filename: part.filename,
              mediaType,
              text,
              isWorkbookMap: true,
              isShortened: text !== textContent,
              isGoogleSheet: true,
              remainingBytes: officeBytesRemaining,
            })

            officeBytesRemaining = formatted.remainingBytes
            convertedParts.push({ type: 'text', text: formatted.text })
            continue
          }

          convertedParts.push({
            type: 'text',
            text: formatTextFilePart({
              filename: part.filename,
              mediaType,
              content: textContent,
            }),
          })
          continue
        } catch (exception) {
          logger.set({
            fileConversion: {
              operation: 'inline-text',
              storageKey,
            },
            attributes: {
              fileConversion: {
                error: exceptionMessage(exception),
              },
            },
          })
          missingFiles.push({
            storageKey,
            filename: part.filename,
          })
          continue
        }
      }

      try {
        const cachedDataUrl = await getCachedFileDataUrl(
          storageKey,
          logger,
        )

        if (cachedDataUrl) {
          convertedParts.push({
            ...part,
            url: cachedDataUrl,
          })
          continue
        }

        const dataUrl = await convertStorageFileToDataUrl(
          storage,
          storageKey,
          mediaType,
          logger,
        )

        if (dataUrl) {
          await cacheFileDataUrl(storageKey, dataUrl, logger)
          convertedParts.push({
            ...part,
            url: dataUrl,
          })
          continue
        }

        missingFiles.push({
          storageKey,
          filename: part.filename,
        })
      } catch (exception) {
        logger.set({
          fileConversion: {
            operation: 'convert',
            storageKey,
          },
          attributes: {
            fileConversion: {
              error: exceptionMessage(exception),
            },
          },
        })
        missingFiles.push({
          storageKey,
          filename: part.filename,
        })
      }
    }

    convertedMessages.push({
      ...message,
      parts: convertedParts,
    })
  }

  return {
    messages: convertedMessages,
    missingFiles,
    unsupportedFiles,
  }
}

export interface LoadOwnedGeneratedImageInput {
  userId: number
  storageKey: string
  storage: ReturnType<typeof useFileStorage>
  logger: LoggerLike
}

/**
 * Loads one image the assistant generated for this user as a data URL. Runs
 * inside the AI SDK tool loop, so it takes its storage and logger explicitly
 * and never reads the request event. Returns null when the file is not owned
 * by the user, is not an assistant-generated file, or is gone from storage.
 */
export async function loadOwnedGeneratedImageDataUrl(
  input: LoadOwnedGeneratedImageInput,
): Promise<string | null> {
  const { userId, storageKey, storage, logger } = input
  const ownedFiles = await getOwnedGeneratedImageFilesByStorageKeys(
    userId,
    [storageKey],
  )
  const file = ownedFiles.get(storageKey)

  if (!file) {
    logger.set({
      attributes: {
        imageGeneration: { previousImageMissing: 'not-owned' },
      },
    })

    return null
  }

  const cachedDataUrl = await getCachedFileDataUrl(storageKey, logger)

  if (cachedDataUrl) {
    return cachedDataUrl
  }

  const dataUrl = await convertStorageFileToDataUrl(
    storage,
    storageKey,
    file.type,
    logger,
  )

  if (!dataUrl) {
    logger.set({
      attributes: {
        imageGeneration: { previousImageMissing: 'missing-object' },
      },
    })

    return null
  }

  await cacheFileDataUrl(storageKey, dataUrl, logger)

  return dataUrl
}

async function getCachedFileDataUrl(
  storageKey: string,
  logger: LoggerLike,
): Promise<string | null> {
  try {
    const kv = useKV()
    const cacheKey = getCacheKey(storageKey)
    const cached = await kv.get(cacheKey, 'text')

    return cached
  } catch (exception) {
    logger.set({
      fileCache: {
        operation: 'read',
        key: getCacheKey(storageKey),
      },
      attributes: {
        fileCache: {
          error: exceptionMessage(exception),
        },
      },
    })

    return null
  }
}

async function cacheFileDataUrl(
  storageKey: string,
  dataUrl: string,
  logger: LoggerLike,
): Promise<void> {
  try {
    const kv = useKV()
    const cacheKey = getCacheKey(storageKey)

    await kv.put(cacheKey, dataUrl, {
      expirationTtl: CACHE_TTL_SECONDS,
    })
  } catch (exception) {
    logger.set({
      fileCache: {
        operation: 'write',
        key: getCacheKey(storageKey),
      },
      attributes: {
        fileCache: {
          error: exceptionMessage(exception),
        },
      },
    })
  }
}

async function readStorageFileAsText(
  storage: ReturnType<typeof useFileStorage>,
  storageKey: string,
  logger: LoggerLike,
): Promise<string | null> {
  try {
    const file = await storage.get(storageKey)

    if (!file) {
      return null
    }

    return await file.text()
  } catch (exception) {
    logger.set({
      fileStorage: {
        operation: 'read-text',
        storageKey,
      },
      attributes: {
        fileStorage: {
          error: exceptionMessage(exception),
        },
      },
    })

    return null
  }
}

function formatTextFilePart(input: {
  filename?: string
  mediaType: string
  content: string
}): string {
  const language = pickCodeFenceLanguage(input.filename, input.mediaType)
  const fence = '`'.repeat(computeFenceLength(input.content))
  const header = input.filename ? `**${input.filename}**\n\n` : ''

  return `${header}${fence}${language}\n${input.content}\n${fence}`
}

const UNSUPPORTED_FILE_NOTES: Record<string, string> = {
  'legacy-office': 'a legacy Office format that cannot be read',
  'office-unreadable': 'no text could be read from this document',
  'model-no-image': 'the model does not read images',
  'model-no-pdf': 'the model does not read PDFs',
}

function formatUnsupportedFilePart(
  filename: string | undefined,
  reason: FileDeliveryReason | undefined,
): string {
  const header = filename ? `**${filename}**\n\n` : ''
  const note = (reason && UNSUPPORTED_FILE_NOTES[reason])
    || 'this file type cannot be sent to the model'

  return `${header}[File not included: ${note}.]`
}

function formatSandboxFilePart(filename: string | undefined): string {
  const header = filename ? `**${filename}**\n\n` : ''

  return `${header}[Available in the code sandbox. No text of it is included here.]`
}

interface FormattedOfficeFilePart {
  text: string
  remainingBytes: number
}

/**
 * Wraps extracted Office text for the model: the file name and format, a line
 * that says what the text lacks, then the Markdown in a fence. Each file is
 * cut at 200 KB and each message at 512 KB (on a UTF-8 boundary), with a
 * marker so the model knows the text is partial.
 */
function formatOfficeFilePart(input: {
  filename?: string
  mediaType: string
  text: string
  isWorkbookMap: boolean
  isShortened: boolean
  isGoogleSheet?: boolean
  remainingBytes: number
}): FormattedOfficeFilePart {
  const format = getOfficeFormatByMediaType(input.mediaType) as OfficeFormat
  const noun = input.isGoogleSheet
    ? GOOGLE_SHEET_NOUN
    : OFFICE_FORMAT_NOUNS[format]
  const name = input.filename ? `**${input.filename}** (${noun})` : noun
  let note = input.isWorkbookMap ? WORKBOOK_MAP_NOTE : EXTRACTED_TEXT_NOTE

  if (input.isGoogleSheet) {
    note = GOOGLE_WORKBOOK_MAP_NOTE
  }

  const shortened = input.isShortened ? ` ${SHORTENED_MAP_NOTE}` : ''
  const header = `${name}\n\n${note}${shortened}\n\n`

  if (input.remainingBytes <= 0) {
    return {
      text: `${header}[Not included: this message already carries 512 KB of extracted file text.]`,
      remainingBytes: 0,
    }
  }

  const limit = Math.min(OFFICE_TEXT_INLINE_MAX_BYTES, input.remainingBytes)
  const cut = truncateUtf8(input.text, limit)
  const fence = '`'.repeat(computeFenceLength(cut.text))
  const marker = cut.truncated
    ? `\n\n[Truncated: only the first ${Math.round(limit / 1024)} KB of this file's text is included.]`
    : ''

  return {
    text: `${header}${fence}md\n${cut.text}\n${fence}${marker}`,
    remainingBytes: input.remainingBytes - cut.bytes,
  }
}

function pickCodeFenceLanguage(
  filename: string | undefined,
  mediaType: string,
): string {
  if (filename) {
    const lastDot = filename.lastIndexOf('.')

    if (lastDot >= 0 && lastDot < filename.length - 1) {
      const extension = filename.slice(lastDot + 1).toLowerCase()

      if (extension === 'markdown') {
        return 'md'
      }

      if (/^[a-z0-9]+$/.test(extension)) {
        return extension
      }
    }
  }

  const subtype = normalizeMediaType(mediaType).split('/')[1] || ''

  if (!subtype) {
    return 'txt'
  }

  if (subtype === 'plain') {
    return 'txt'
  }

  return subtype.replace(/^x-/, '')
}

function computeFenceLength(content: string): number {
  const runs = content.match(/`+/g) || []
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0)

  return Math.max(3, longest + 1)
}

async function convertStorageFileToDataUrl(
  storage: ReturnType<typeof useFileStorage>,
  storageKey: string,
  mediaType: string,
  logger: LoggerLike,
): Promise<string | null> {
  try {
    const file = await storage.get(storageKey)

    if (!file) {
      return null
    }

    const arrayBuffer = await file.arrayBuffer()
    const base64 = arrayBufferToBase64(arrayBuffer)

    return `data:${mediaType};base64,${base64}`
  } catch (exception) {
    logger.set({
      fileStorage: {
        operation: 'read',
        storageKey,
      },
      attributes: {
        fileStorage: {
          error: exceptionMessage(exception),
        },
      },
    })

    return null
  }
}

export async function invalidateFileCache(
  storageKey: string,
  logger?: LoggerLike,
): Promise<void> {
  const activeLogger = resolveServerLogger(logger)

  try {
    const kv = useKV()
    const cacheKey = getCacheKey(storageKey)

    await kv.delete(cacheKey)
    await kv.delete(getOfficeTextUpgradeFailedKey(storageKey))
  } catch (exception) {
    activeLogger.set({
      fileCache: {
        operation: 'invalidate',
        key: getCacheKey(storageKey),
      },
      attributes: {
        fileCache: {
          error: exceptionMessage(exception),
        },
      },
    })
  }
}

function getCacheKey(storageKey: string): string {
  return `${FILE_CACHE_PREFIX}${storageKey}`
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 32 * 1024
  let binary = ''

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)

    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}
