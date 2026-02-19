import type { UIMessage } from 'ai'
import { useLogger } from 'evlog'
import {
  extractStorageKeyFromFileUrl,
  getOwnedFilesByStorageKeys,
} from '~~/server/utils/files/file-governance'
import {
  resolveServerLogger,
} from '~~/server/utils/files/logger'
import type { LoggerLike } from '~~/server/utils/files/logger'

export interface MissingFile {
  storageKey: string
  filename?: string
}

export interface ConversionResult {
  messages: UIMessage[]
  missingFiles: MissingFile[]
}

const CACHE_TTL_SECONDS = 5 * 60
const FILE_CACHE_PREFIX = 'file-cache:'

export async function convertFilesForAI(
  messages: UIMessage[],
): Promise<ConversionResult> {
  const logger = useLogger(useEvent())
  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)
  const missingFiles: MissingFile[] = []
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
            url: part.url,
          },
        })
        convertedParts.push(part)
        continue
      }

      if (!ownedFiles.has(storageKey)) {
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
          part.mediaType,
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
            error: exception instanceof Error
              ? exception.message
              : String(exception),
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
  }
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
        error: exception instanceof Error
          ? exception.message
          : String(exception),
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
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })
  }
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
        error: exception instanceof Error
          ? exception.message
          : String(exception),
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
  } catch (exception) {
    activeLogger.set({
      fileCache: {
        operation: 'invalidate',
        key: getCacheKey(storageKey),
        error: exception instanceof Error
          ? exception.message
          : String(exception),
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
